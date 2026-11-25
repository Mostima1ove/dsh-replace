// 打包器的小样本自测：只挑几个小文件，几秒钟跑完，不烧 CPU。
// 要验的只有三件事：
//   1. 打出来的容器能让自己的读取器读回来，字节一致
//   2. 密码错了要解不开（不能默默给出半截数据）
//   3. 不设密码也能正常解包
//
// 跑法：node test_pack.mjs

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { pack } from './lib/pack.js'
import { unpack } from './lib/unpack.js'

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dshmove-test-'))

// 造三个样本文件：一个纯文本、一个中文名、一个几百 KB 的随机二进制
const srcDir = path.join(tmp, 'src')
await fs.mkdir(srcDir, { recursive: true })

const text = '这是一段中文，用来验证 UTF-8 路径和内容都不会被搞坏。\n'
await fs.writeFile(path.join(srcDir, '笔记.txt'), text, 'utf8')

const bin = crypto.randomBytes(300 * 1024)
await fs.writeFile(path.join(srcDir, '随机.bin'), bin)

await fs.writeFile(path.join(srcDir, 'empty.txt'), '', 'utf8')

const entries = [
  { rel: '笔记.txt', abs: path.join(srcDir, '笔记.txt'), size: Buffer.byteLength(text) },
  { rel: '随机.bin', abs: path.join(srcDir, '随机.bin'), size: bin.length },
  { rel: 'empty.txt', abs: path.join(srcDir, 'empty.txt'), size: 0 },
]

const plan = {
  home: srcDir,
  entries,
  skipped: [],
  groups: [{ key: 't', label: '测试', files: 3, bytes: entries.reduce((n, e) => n + e.size, 0) }],
  totals: { files: 3, bytes: entries.reduce((n, e) => n + e.size, 0) },
}

let ok = 0
let bad = 0
const check = (name, cond, extra = '') => {
  if (cond) {
    ok++
    console.log(`  ✓ ${name}`)
  } else {
    bad++
    console.log(`  ✗ ${name} ${extra}`)
  }
}

// ---- 1. 带密码 ----
console.log('带密码：')
const outA = path.join(tmp, 'out-a')
const a = await pack({ outDir: outA, password: 'abc123', plan, stamp: 'T1' })
console.log(`  包：${a.bytes} 字节，${a.encrypted ? '已加密' : '未加密'}`)
check('生成的是加密包', a.encrypted === true)

const backA = path.join(tmp, 'back-a')
const ra = await unpack({ packPath: a.target, password: 'abc123', outDir: backA })
check('解出 3 个文件', ra.files === 3, `实际 ${ra.files}`)

const t = await fs.readFile(path.join(backA, '笔记.txt'), 'utf8')
check('文本内容一致', t === text)
const b = await fs.readFile(path.join(backA, '随机.bin'))
check('二进制大小一致', b.length === bin.length, `${b.length} vs ${bin.length}`)
check('二进制内容一致', Buffer.compare(b, bin) === 0)
const e = await fs.stat(path.join(backA, 'empty.txt'))
check('空文件还在', e.size === 0)

// ---- 2. 密码错了 ----
console.log('密码错：')
let refused = false
try {
  await unpack({ packPath: a.target, password: 'wrong-one', outDir: path.join(tmp, 'back-x') })
} catch (err) {
  refused = /密码|损坏|校验/.test(String(err && err.message))
}
check('错误密码被拒', refused)

// ---- 3. 不设密码 ----
console.log('不加密：')
const b2 = await pack({ outDir: path.join(tmp, 'out-b'), password: '', plan, stamp: 'T2' })
check('生成的是未加密包', b2.encrypted === false)
const rb = await unpack({ packPath: b2.target, password: '', outDir: path.join(tmp, 'back-b') })
check('不加密也能解', rb.files === 3)
const t2 = await fs.readFile(path.join(tmp, 'back-b', '笔记.txt'), 'utf8')
check('不加密内容一致', t2 === text)

console.log('')
console.log(bad === 0 ? `全部通过（${ok} 项）` : `${ok} 项通过，${bad} 项失败`)

await fs.rm(tmp, { recursive: true, force: true })
process.exit(bad === 0 ? 0 : 1)
