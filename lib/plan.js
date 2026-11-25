// 搬家 · 打包计划
//
// 这个文件只干一件事：把「要带走什么」算出来，返回一张清单。
// 不写盘、不压缩、不加密——先看清楚包里该有什么，再动手。
//
// 设计取舍：**白名单，不是黑名单**。
//   黑名单永远是漏的：今天新增一个 xx-cache 目录，明天包里就多几百兆垃圾；
//   反过来，白名单漏了新东西，至少是「少带走」而不是「多带一堆不该带的」。
//   所以这里列清楚要什么，其余一律不碰。

import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'

/** DSH 的家目录。环境变量优先，和 DSH 自己保持一致。 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh')
}

/**
 * 要整个带走的一级目录。
 * key 用来在报告里分组，label 是给人看的名字。
 */
const DIR_GROUPS = [
  { key: 'sessions', label: '会话' },
  { key: 'attachments', label: '附件' },
  { key: 'skills', label: '技能' },
  { key: 'storages', label: '插件数据' },
  { key: 'bili-duty', label: 'B站插件数据' },
  { key: 'fish-memory', label: '长期记忆' },
  { key: 'fish-memory-backup', label: '长期记忆备份' },
  { key: 'whale-persona', label: '人设' },
  { key: 'whale-roles', label: '角色' },
  { key: 'feiyu-mood', label: '情绪' },
  { key: '.agent-presets', label: '预设' },
]

/** 只挑几个文件的目录。 */
const FILE_GROUPS = [
  {
    key: 'config',
    label: '配置',
    files: [
      '.credentials.yaml',
      'profiles/desktop/package.json',
      'profiles/desktop/cordis.patch.yml',
      'profiles/desktop/cordis.yml',
      'profiles/desktop/pnpm-lock.yaml',
    ],
  },
]

/** 递归里永远不进去的目录名。 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.venv',
  'venv',
  '.git',
  '__pycache__',
  '.pnpm-store',
  '.cache',
])

/** 递归里永远不带的文件名。 */
const SKIP_FILES = /\.(log|tmp|zstd\.tmp)$/i

/**
 * 按相对路径整段跳过的位置。
 * bili-duty/bin 里躺着一个 30MB 的 uv.exe——那是装 Python 依赖用的工具，
 * 新机器第一次跑插件时会自己下一份，没必要塞进搬家包。
 */
const SKIP_PATHS = ['bili-duty/bin']

/**
 * 根目录下散落的 *.json（各类插件的配置文件，单个都很小）。
 * 用白名单函数判断，避免把未来的大文件卷进来。
 */
const ROOT_JSON_MAX = 2 * 1024 * 1024 // 单文件 2MB 封顶

async function walk(absDir, relDir, acc, skipped) {
  let items
  try {
    items = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const it of items) {
    const rel = relDir ? `${relDir}/${it.name}` : it.name
    const abs = path.join(absDir, it.name)

    if (it.isDirectory()) {
      if (SKIP_DIRS.has(it.name) || SKIP_PATHS.some((p) => rel === p || rel.startsWith(p + '/'))) {
        skipped.push({ rel, reason: '不搬（体积大、可在新机器重装）' })
        continue
      }
      await walk(abs, rel, acc, skipped)
      continue
    }

    if (!it.isFile()) {
      // 符号链接、设备文件之类，一律不碰
      continue
    }

    if (SKIP_FILES.test(it.name)) {
      skipped.push({ rel, reason: '不搬（日志/临时文件）' })
      continue
    }

    let st
    try {
      st = await fs.stat(abs)
    } catch {
      continue
    }
    acc.push({ rel, abs, size: st.size })
  }
}

/**
 * 算出完整的打包清单。
 *
 * @returns {Promise<{home, entries, skipped, groups, totals}>}
 */
export async function buildPlan() {
  const home = dshHome()
  const entries = []
  const skipped = []
  const groups = []

  // 1. 成组的一级目录
  for (const g of DIR_GROUPS) {
    const abs = path.join(home, g.key)
    let stat
    try {
      stat = await fs.stat(abs)
    } catch {
      continue // 这台机器没装这个插件，跳过就是
    }
    if (!stat.isDirectory()) continue

    const before = entries.length
    await walk(abs, g.key, entries, skipped)
    const mine = entries.slice(before)
    groups.push({
      key: g.key,
      label: g.label,
      files: mine.length,
      bytes: mine.reduce((n, e) => n + e.size, 0),
    })
  }

  // 2. 指定的配置文件
  for (const g of FILE_GROUPS) {
    const mine = []
    for (const rel of g.files) {
      const abs = path.join(home, rel)
      try {
        const st = await fs.stat(abs)
        if (!st.isFile()) continue
        mine.push({ rel, abs, size: st.size })
      } catch {
        // 没有就算了
      }
    }
    if (!mine.length) continue
    entries.push(...mine)
    groups.push({
      key: g.key,
      label: g.label,
      files: mine.length,
      bytes: mine.reduce((n, e) => n + e.size, 0),
    })
  }

  // 3. 根目录散落的 json
  {
    const mine = []
    let items = []
    try {
      items = await fs.readdir(home, { withFileTypes: true })
    } catch {
      items = []
    }
    for (const it of items) {
      if (!it.isFile()) continue
      if (!it.name.toLowerCase().endsWith('.json')) continue
      const abs = path.join(home, it.name)
      let st
      try {
        st = await fs.stat(abs)
      } catch {
        continue
      }
      if (st.size > ROOT_JSON_MAX) {
        skipped.push({ rel: it.name, reason: '不搬（单个 json 超过 2MB，多半是缓存）' })
        continue
      }
      mine.push({ rel: it.name, abs, size: st.size })
    }
    if (mine.length) {
      entries.push(...mine)
      groups.push({
        key: 'root-json',
        label: '插件设置',
        files: mine.length,
        bytes: mine.reduce((n, e) => n + e.size, 0),
      })
    }
  }

  const totals = {
    files: entries.length,
    bytes: entries.reduce((n, e) => n + e.size, 0),
  }

  return { home, entries, skipped, groups, totals }
}

/** 默认输出位置：桌面；桌面不存在就落到盘根。 */
export function defaultOutDir(stamp) {
  const desktop = path.join(homedir(), 'Desktop')
  return path.join(desktop, `DSH搬家包-${stamp}`)
}

/** 20261125-1630 这种，给目录名用。 */
export function makeStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}`
  )
}

/** 字节数转人话。 */
export function human(bytes) {
  const u = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}
