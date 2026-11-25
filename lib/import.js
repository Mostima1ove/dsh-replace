// 搬家 · 导入
//
// unpack.js 只负责把包倒到一个空目录；这里才决定每个文件该落在哪儿、
// 撞上原来的东西怎么办、以及最后给出一份「到底动了什么」的账。

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { unpack } from './unpack.js'
import { adaptPath, adaptWorkspace } from './adapt.js'

// 这两个不能照搬。
// package.json 照搬会把新机器上的插件列表整个冲掉——用户装过的插件全消失，
// 这比不搬还糟；所以只把包里「本地没有」的依赖和 bundle 加进去。
// lock 文件照样搬会和新 package.json 对不上，索性跳过，让 pnpm 自己算。
const MERGE_FILES = new Set(['profiles/desktop/package.json'])
const SKIP_FILES = new Set(['profiles/desktop/pnpm-lock.yaml'])

export function backupStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

const norm = (p) => p.replace(/\\/g, '/')

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** 大小一样就已经很可能是同一份；再比开头 4KB，几乎不会误判，又不用整份读。 */
async function looksSame(a, b) {
  const [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b)])
  if (sa.size !== sb.size) return false
  const n = Math.min(4096, sa.size)
  if (!n) return true
  const [ha, hb] = await Promise.all([
    fs.open(a, 'r').then(async (fh) => {
      const buf = Buffer.alloc(n)
      await fh.read(buf, 0, n, 0)
      await fh.close()
      return buf
    }),
    fs.open(b, 'r').then(async (fh) => {
      const buf = Buffer.alloc(n)
      await fh.read(buf, 0, n, 0)
      await fh.close()
      return buf
    }),
  ])
  return ha.equals(hb)
}

async function walk(dir, base = dir, out = []) {
  const items = await fs.readdir(dir, { withFileTypes: true })
  for (const it of items) {
    const abs = path.join(dir, it.name)
    if (it.isDirectory()) await walk(abs, base, out)
    else if (it.isFile()) out.push(path.relative(base, abs))
  }
  return out
}

/**
 * 把搬来的 package.json 合到本地那份上。
 *
 * 只加不减：本地有的一个都不动（那是用户在这台机器上装的），
 * 包里多出来的追加进去。插件本体不跟着包走，所以「加了名字」不等于「能用了」——
 * 差的那一步会写进搬家说明里。
 */
async function mergePackageJson(srcFile, destFile) {
  let local = null
  try {
    local = JSON.parse(await fs.readFile(destFile, 'utf8'))
  } catch {
    local = null
  }
  const incoming = JSON.parse(await fs.readFile(srcFile, 'utf8'))

  // 本地没有 package.json（新机器还没跑过 DSH）——那就整个用包里的
  if (!local) {
    await fs.writeFile(destFile, JSON.stringify(incoming, null, 2) + '\n', 'utf8')
    return { created: true, bundles: [], deps: [] }
  }

  local.dsh = local.dsh || {}
  local.dsh.profile = local.dsh.profile || {}
  const lb = Array.isArray(local.dsh.profile.bundles) ? local.dsh.profile.bundles : []
  local.dsh.profile.bundles = lb

  const bundles = []
  for (const b of incoming?.dsh?.profile?.bundles || []) {
    if (!lb.includes(b)) {
      lb.push(b)
      bundles.push(b)
    }
  }

  local.dependencies = local.dependencies || {}
  const deps = []
  for (const [k, v] of Object.entries(incoming?.dependencies || {})) {
    if (!(k in local.dependencies)) {
      local.dependencies[k] = v
      deps.push(k)
    }
  }

  await fs.writeFile(destFile, JSON.stringify(local, null, 2) + '\n', 'utf8')
  return { created: false, bundles, deps }
}

/**
 * 导入一份搬家包。
 *
 * 冲突的规矩：搬来的赢，本地那份改名让路（<文件名>.bak-<日期>-<时分>）。
 * 不删任何东西，最坏的情况是目录里多出一堆 .bak 文件，人还能一个个找回来。
 *
 * @param {object} o
 * @param {string} o.packPath
 * @param {string} [o.password]
 * @param {string} o.home       目标 DSH_HOME
 * @param {string} [o.stamp]
 * @param {(p:{phase:string,done:number,total:number,note?:string})=>void} [o.onProgress]
 */
export async function importPack({ packPath, password, home, stamp, onProgress, fallbackRoot }) {
  const say = (p) => {
    try {
      onProgress && onProgress(p)
    } catch {
      /* 进度回调不该把导入带崩 */
    }
  }

  const tag = stamp || backupStamp()
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dshmove-in-'))
  const stage = path.join(tmp, 'files')

  const report = {
    written: [],
    replaced: [],
    backedUp: [],
    skipped: [],
    merged: null,
    errors: [],
    tag,
    home,
  }

  try {
    say({ phase: '读包', done: 0, total: 0 })
    const { manifest } = await unpack({
      packPath,
      password,
      outDir: stage,
      onProgress: (p) => say({ phase: '解包', done: p.done || 0, total: p.total || 0, note: p.note }),
    })

    const rels = await walk(stage)
    const olds = Array.isArray(manifest.workspaces) ? manifest.workspaces : []
    const total = rels.length
    say({ phase: '写入', done: 0, total, note: '' })

    let done = 0
    for (const rel of rels) {
      const key = norm(rel)
      const src = path.join(stage, rel)
      const dest = path.join(home, rel)

      if (SKIP_FILES.has(key)) {
        report.skipped.push({ rel: key, why: '锁文件交给 pnpm 重新生成' })
        done++
        continue
      }

      try {
        await fs.mkdir(path.dirname(dest), { recursive: true })

        if (MERGE_FILES.has(key)) {
          const m = await mergePackageJson(src, dest)
          report.merged = { rel: key, ...m }
          done++
          continue
        }

        const had = await exists(dest)
        if (had) {
          if (await looksSame(src, dest)) {
            report.skipped.push({ rel: key, why: '和本地完全一样' })
            done++
            continue
          }
          const bak = `${dest}.bak-${tag}`
          await fs.rename(dest, bak)
          report.backedUp.push({ rel: key, bak: norm(path.relative(home, bak)) })
          await fs.copyFile(src, dest)
          report.replaced.push(key)
        } else {
          await fs.copyFile(src, dest)
          report.written.push(key)
        }
      } catch (e) {
        report.errors.push({ rel: key, error: String((e && e.message) || e) })
      }

      done++
      if (done % 50 === 0) say({ phase: '写入', done, total, note: key })
    }

    // ---- 路径适配 ----
    // 上面的文件是按「旧机器上的样子」放下的。这一步才把它们挪到新机器上该在的位置。
    //
    // 规矩：能原样就原样。只有当旧路径在新机器上根本不成立（盘符没有）时才换地方。
    // 换地方的时候只改会话文件的第一帧（元数据里的 cwd），后面几千帧一个字节不碰。
    say({ phase: '适配路径', done: 0, total: olds.length })
    const moved = []
    const root = fallbackRoot || path.join(os.homedir(), 'DSH搬家-工作区')

    for (let i = 0; i < olds.length; i++) {
      const w = olds[i]
      say({ phase: '适配路径', done: i + 1, total: olds.length, note: w.cwd })

      // 路径是从目录名猜出来的（那条工作区一条会话都没有），不敢当真。
      // 猜错一次就会在别人电脑上凭空建一堆奇怪的目录，所以宁可不动。
      if (w.guessed) {
        moved.push({ old: w.cwd, now: w.cwd, how: '路径读不准，没动', sessions: 0 })
        continue
      }

      let plan
      try {
        plan = adaptPath(w.cwd, { fallbackRoot: root })
      } catch (e) {
        report.errors.push({ rel: `工作区 ${w.cwd}`, error: String((e && e.message) || e) })
        continue
      }

      if (plan.mkdir) {
        try {
          await fs.mkdir(plan.path, { recursive: true })
        } catch (e) {
          report.errors.push({ rel: `工作区 ${w.cwd}`, error: '建不出目录：' + ((e && e.message) || e) })
          continue
        }
      }

      if (plan.path === w.cwd) {
        moved.push({ old: w.cwd, now: plan.path, how: '原样', sessions: 0 })
        continue
      }

      try {
        const r = await adaptWorkspace(home, { oldKey: w.key, oldCwd: w.cwd, newCwd: plan.path })
        moved.push({ old: w.cwd, now: plan.path, how: plan.how, sessions: r.sessions })
      } catch (e) {
        report.errors.push({ rel: `工作区 ${w.cwd}`, error: String((e && e.message) || e) })
      }
    }
    report.workspaces = moved

    say({ phase: '完成', done: total, total })

    return {
      manifest,
      host: manifest.host || {},
      report,
      totals: {
        files: total,
        written: report.written.length,
        replaced: report.replaced.length,
        skipped: report.skipped.length,
        failed: report.errors.length,
      },
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * 包里装了、但这台机器上没有的插件。
 *
 * 插件代码不进包（node_modules 几百兆，搬过来多半还和这台机器的 DSH 版本对不上），
 * 所以「迁移」只能搬数据。这里列出名字，让人自己去装——沉默地缺一半功能最坑。
 */
export function missingPlugins({ manifest, localPkg }) {
  const want = manifest?.plugins?.bundles || []
  const have = new Set(localPkg?.dsh?.profile?.bundles || [])
  return want.filter((n) => !have.has(n))
}
