// 拿真数据试一次，但只挑最小的那几组（记忆 + 人设 + 配置，约 1MB），
// 免得为了验证把整台机器拖起来。
//
// 跑法：node test_real.mjs

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { buildPlan, human } from './lib/plan.js'
import { pack } from './lib/pack.js'
import { unpack } from './lib/unpack.js'

const t0 = Date.now()

// 只留最小的几组：不碰会话、附件、技能
const SMALL = new Set(['fish-memory', 'fish-memory-backup', 'whale-persona', 'whale-roles', 'feiyu-mood', 'config', 'root-json'])

const full = await buildPlan()
const groups = full.groups.filter((g) => SMALL.has(g.key))
const keys = new Set(groups.map((g) => g.key))

// entries 是按组顺序推进来的，按组重扫一遍更稳：这里直接用文件量小的判断
const entries = full.entries.filter((e) => {
  const head = e.rel.split('/')[0]
  if (e.rel.includes('/')) {
    return keys.has(head)
  }
  // 根目录散落的 json / .credentials.yaml
  return e.rel.endsWith('.json') || e.rel === '.credentials.yaml'
})

const plan = {
  home: full.home,
  entries,
  skipped: [],
  groups,
  totals: { files: entries.length, bytes: entries.reduce((n, e) => n + e.size, 0) },
}

console.log('样本：', plan.totals.files, '个文件 /', human(plan.totals.bytes))
for (const g of groups) console.log('  ' + g.label, g.files, '个', human(g.bytes))

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dshmove-real-'))

try {
  const r = await pack({
    outDir: tmp,
    password: 'test123',
    plan,
    stamp: 'REAL',
    onProgress: (p) => {
      if (p.phase === '完成') return
    },
  })
  console.log('')
  console.log('包：', human(r.bytes), '→', r.dir)

  const back = path.join(tmp, 'back')
  const u = await unpack({ packPath: r.target, password: 'test123', outDir: back })
  console.log('解出：', u.files, '个文件 /', human(u.bytes))

  // 抽查三个：人前那份、记忆里最新那份、配置
  const pick = []
  for (const e of entries) {
    if (e.rel.startsWith('fish-memory/')) pick.push(e)
  }
  const sample = [pick[0], entries.find((e) => e.rel === 'config' || e.rel.includes('cordis.patch')), entries[0]].filter(Boolean)

  let bad = 0
  for (const e of sample) {
    const a = await fs.readFile(e.abs)
    const b = await fs.readFile(path.join(back, e.rel))
    const same = Buffer.compare(a, b) === 0
    console.log(`  ${same ? '✓' : '✗'} ${e.rel} (${a.length} 字节)`)
    if (!same) bad++
  }

  console.log('')
  console.log(bad === 0 ? `样本全部一致 · 用时 ${Date.now() - t0}ms` : `${bad} 个样本不一致`)
} finally {
  if (process.env.KEEP) console.log('保留在：', tmp)
  else await fs.rm(tmp, { recursive: true, force: true })
}
