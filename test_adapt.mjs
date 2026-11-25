// 路径适配自测。
// 重点不是"改成功"，而是"改完之后，第一帧以外一个字节都没动"。
//   node test_adapt.mjs

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { encodeKey, firstFrameCwd, readWorkspaces, adaptPath, rewriteSessionCwd } from './lib/adapt.js'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

let pass = 0
let fail = 0
const ok = (name, cond, extra) => {
  if (cond) {
    pass++
    console.log('  ✓', name)
  } else {
    fail++
    console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra))
  }
}

function splitFrames(buf) {
  const hits = []
  let pos = buf.indexOf(MAGIC, 0)
  while (pos !== -1) {
    hits.push(pos)
    pos = buf.indexOf(MAGIC, pos + 1)
  }
  return hits
}

function decodeAll(buf) {
  const hits = splitFrames(buf)
  const parts = []
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i]
    const end = i + 1 < hits.length ? hits[i + 1] : buf.length
    parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8'))
  }
  return parts.join('')
}

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dshmove-adapt-'))

try {
  // ---------- 1. 编码规则 ----------
  ok('encodeKey 中文', encodeKey('D:\\阁楼\\DS-work') === '--D-~9601~697C-DS-work--', encodeKey('D:\\阁楼\\DS-work'))
  ok('encodeKey 纯英文', encodeKey('C:\\Users\\Administrator\\Documents\\deepseek-harness\\default-workspace') === '--C-Users-Administrator-Documents-deepseek-harness-default-workspace--')
  ok('encodeKey 短路径', encodeKey('D:\\a') === '--D-a--', encodeKey('D:\\a'))

  // ---------- 2. 真机上的工作区，key 全部对得上 ----------
  const real = await readWorkspaces(HOME)
  ok('扫到工作区', real.length >= 3, real.length)
  const mismatched = real.filter((w) => encodeKey(w.cwd) !== w.key)
  ok('每个工作区的 cwd 都能编码回原目录名', mismatched.length === 0, mismatched.map((w) => [w.key, w.cwd]))
  console.log('     ', real.map((w) => `${w.key} → ${w.cwd}（${w.sessions} 条会话）`).join('\n      '))

  // ---------- 3. adaptPath 三种情况 ----------
  ok('已存在的路径原样', adaptPath(HOME, { fallbackRoot: tmp }).how === '原样')
  ok('同盘符不存在的路径 → 建目录', adaptPath('C:\\Users\\Administrator\\no-such-dir-xyz\\deep', { fallbackRoot: tmp }).how === '建目录')
  const ghost = adaptPath('Q:\\不存在的盘\\作品', { fallbackRoot: tmp })
  ok('盘符不存在 → 改落点', ghost.how === '改落点', ghost)
  ok('改落点后路径落在备用根下', ghost.path.startsWith(tmp), ghost.path)

  // ---------- 4. 改写第一帧：后面一个字节都不许动 ----------
  const biggest = real
    .filter((w) => w.sessions > 0)
    .map((w) => {
      const dir = path.join(HOME, 'sessions', w.key)
      const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())
      let best = null
      for (const s of subs) {
        const f = path.join(dir, s.name, 'session.v4.jsonl.zstd')
        const size = fs.statSync(f).size
        if (!best || size > best.size) best = { f, size }
      }
      return best
    })
    .sort((a, b) => b.size - a.size)[0]

  const copy = path.join(tmp, 'sample.zstd')
  fs.copyFileSync(biggest.f, copy)
  console.log(`      样本 ${(biggest.size / 1024 / 1024).toFixed(1)} MB`)

  const before = fs.readFileSync(copy)
  const beforeFrames = splitFrames(before)
  const beforeText = decodeAll(before)
  const beforeCwd = firstFrameCwd(copy)

  const changed = rewriteSessionCwd(copy, 'E:\\新机器\\作品集')
  ok('改写确实发生', changed === true)

  const after = fs.readFileSync(copy)
  const afterFrames = splitFrames(after)
  const afterText = decodeAll(after)
  const afterCwd = firstFrameCwd(copy)

  ok('cwd 改成了新路径', afterCwd === 'E:\\新机器\\作品集', afterCwd)
  ok('帧总数没变', afterFrames.length === beforeFrames.length, { a: beforeFrames.length, b: afterFrames.length })

  const beforeFirstLen = beforeFrames[1]
  const afterFirstLen = afterFrames[1]
  const beforeRest = before.subarray(beforeFirstLen)
  const afterRest = after.subarray(afterFirstLen)
  ok('第一帧之后的字节完全一致', beforeRest.length === afterRest.length && sha(beforeRest) === sha(afterRest), {
    before: beforeRest.length,
    after: afterRest.length,
  })

  const bLines = beforeText.split('\n')
  const aLines = afterText.split('\n')
  ok('行数没变', bLines.length === aLines.length, { a: bLines.length, b: aLines.length })
  ok('除第一行外每一行都一致', bLines.slice(1).join('\n') === aLines.slice(1).join('\n'))
  ok('第一行只有 cwd 变了', (() => {
    const x = JSON.parse(bLines[0])
    const y = JSON.parse(aLines[0])
    x.cwd = null
    y.cwd = null
    return JSON.stringify(x) === JSON.stringify(y)
  })())

  // 幂等：再改一次同样的值，应该什么都不做
  ok('改成同一个路径不重复写', rewriteSessionCwd(copy, 'E:\\新机器\\作品集') === false)

  // ---------- 5. 坏文件不动手 ----------
  const junk = path.join(tmp, 'junk.zstd')
  fs.writeFileSync(junk, Buffer.from('not a zstd frame at all'))
  ok('不是会话文件就拒绝', rewriteSessionCwd(junk, 'X:\\y') === false)
  ok('拒绝之后文件没变', fs.readFileSync(junk).toString() === 'not a zstd frame at all')

  console.log('')
  console.log(`  原来 cwd = ${beforeCwd}`)
} catch (e) {
  fail++
  console.log('  ✗ 抛异常：', e && e.stack)
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {})
}

console.log('')
console.log(fail === 0 ? `全部通过（${pass} 项）` : `${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
