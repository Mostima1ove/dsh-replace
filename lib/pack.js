// 搬家 · 打包
//
// 产出是一个单文件（.dshpack），结构：
//
//   "DSHMOVE1\n"                 ← 8 字节魔数，认出来就不装瞎
//   [u32 头长度][JSON 头]        ← 明文，双击不加密也能看出这是谁的包
//   [16 字节 salt][12 字节 iv]   ← 有密码才有
//   [密文 …][16 字节 GCM tag]    ← 有密码才有
//
// 明文正文（加密前）是 gzip 过的容器，一串：
//   [u32 路径长][路径 UTF-8][u64 文件长][文件字节]
//
// 为什么不用 zip：zip 的字段宽度和文件数上限都够用，但要额外依赖，
// 而这一版的容器只有十几行代码，出问题能自己拆开看。

import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { once } from 'node:events'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import os from 'node:os'
import { writeReadme } from './readme.js'

export const MAGIC = Buffer.from('DSHMOVE1\n', 'ascii')
export const PACK_EXT = '.dshpack'

const KDF_ITERATIONS = 100000
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16

/** 目标目录里已经有一份同样的包时，加 -2 / -3，不覆盖。 */
async function uniqueDir(base) {
  let candidate = base
  for (let i = 2; i < 1000; i++) {
    try {
      await fs.access(candidate)
      candidate = `${base}-${i}`
    } catch {
      return candidate
    }
  }
  throw new Error('同名目录太多了，换个位置吧')
}

/** 磁盘剩余空间够不够（Windows 用 statfs 拿不到，退回 fsutil，失败就当够）。 */
async function hasRoom(dir, needBytes) {
  try {
    const st = await fs.statfs(path.parse(dir).root)
    return st.bavail * st.bsize > needBytes * 1.15
  } catch {
    return true
  }
}

function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

function u64(n) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n), 0)
  return b
}

/**
 * 把一个文件按「恰好 size 字节」灌进目标流。
 * 文件在打包途中被别的进程改小了 → 补零；变大了 → 多的不要。
 * 两种都保证容器不错位：宁可多几个零，也不能让后面所有文件全乱。
 */
async function pipeExactly(abs, size, dest) {
  let sent = 0
  if (size > 0) {
    const src = createReadStream(abs, { start: 0, end: size - 1, highWaterMark: 1 << 20 })
    try {
      for await (const chunk of src) {
        sent += chunk.length
        if (!dest.write(chunk)) await once(dest, 'drain')
      }
    } catch {
      // 读不了就按已读到的算，后面补零
    }
  }
  if (sent < size) {
    const pad = Buffer.alloc(Math.min(size - sent, 1 << 20))
    let left = size - sent
    while (left > 0) {
      const n = Math.min(left, pad.length)
      if (!dest.write(pad.subarray(0, n))) await once(dest, 'drain')
      left -= n
    }
  }
}

/**
 * 打包。
 *
 * @param {object} opts
 * @param {string} opts.outDir    用户选的位置（会被建成一个目录）
 * @param {string} [opts.password] 空字符串 = 不加密
 * @param {object} opts.plan      buildPlan() 的结果
 * @param {(p:{phase:string, done:number, total:number, note?:string})=>void} [opts.onProgress]
 * @param {string} [opts.stamp]   目录名里的时间戳
 */
export async function pack({ outDir, password, plan, onProgress, stamp }) {
  const say = (p) => {
    try {
      onProgress && onProgress(p)
    } catch {
      /* 进度回调不该把打包带崩 */
    }
  }

  const entries = plan.entries
  const total = entries.length
  if (!total) throw new Error('没有可打包的内容')

  const host = {
    machine: os.hostname(),
    user: os.userInfo().username,
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
    dshHome: plan.home,
  }

  say({ phase: '准备', done: 0, total, note: '检查空间' })

  const encrypted = typeof password === 'string' && password.length > 0
  const targetDirBase = path.join(outDir, `DSH搬家包-${stamp}`)

  // 目标目录先建出来（父目录要存在；不存在就报清楚的错）
  try {
    await fs.mkdir(outDir, { recursive: true })
  } catch (e) {
    throw new Error(`建不了目标目录：${outDir}（${e.message}）`)
  }

  const room = plan.totals.bytes
  if (!(await hasRoom(outDir, room))) {
    throw new Error('目标盘剩余空间不够，换个位置或者先清一清')
  }

  const targetDir = await uniqueDir(targetDirBase)
  await fs.mkdir(targetDir, { recursive: true })

  const fileName = `搬家包${PACK_EXT}`
  const target = path.join(targetDir, fileName)

  // ---- 头 ----
  const salt = encrypted ? crypto.randomBytes(SALT_LEN) : null
  const iv = encrypted ? crypto.randomBytes(IV_LEN) : null
  const key = encrypted
    ? crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, KDF_ITERATIONS, 32, 'sha256')
    : null

  const manifest = {
    format: 'dsh-move',
    version: 1,
    createdAt: new Date().toISOString(),
    encrypted,
    cipher: encrypted ? 'aes-256-gcm' : null,
    kdf: encrypted
      ? { name: 'pbkdf2', hash: 'sha256', iterations: KDF_ITERATIONS, saltLen: SALT_LEN }
      : null,
    // 给密码做个体检：解包时拿它先比一下，错了当场说，不用等解完一堆垃圾才发现
    check: encrypted
      ? crypto.createHmac('sha256', key).update('dsh-move-v1').digest('hex')
      : null,
    host,
    entries: total,
    bytes: plan.totals.bytes,
    groups: plan.groups,
    // 插件清单：写入端记下来，导入端才能告诉人「这几样这台机器上没有」。
    // 插件代码本身不跟着包走（见 README 的取舍），所以这份名单只是账，不是货。
    plugins: plan.plugins || null,
    // 旧机器上有哪几个工作区、每个的真路径是什么。
    // 导入时要靠它在**新机器**上决定会话落到哪，所以必须跟着包走。
    workspaces: plan.workspaces || [],
    skipped: plan.skipped.slice(0, 200),
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')

  const fh = await fs.open(target, 'w')
  // 显式维护写入位置。FileHandle 不传 position 时用的是内部游标，
  // 和后面流式写入混着来会互相踩，写出来的文件头被覆盖掉——踩过一次。
  let pos = 0
  const put = async (buf) => {
    if (!buf.length) return
    await fh.write(buf, 0, buf.length, pos)
    pos += buf.length
  }

  try {
    await put(MAGIC)
    await put(u32(manifestBuf.length))
    await put(manifestBuf)
    if (encrypted) {
      await put(salt)
      await put(iv)
    }

    // ---- 正文：容器 → gzip → (加密) → 文件 ----
    // 压缩级别 1：包里大半是图片和 zstd 过的会话，本来就压不动，
    // 用高压缩级别只是白烧 CPU，体积差不了多少。
    const gzip = zlib.createGzip({ level: 1 })
    const cipher = encrypted ? crypto.createCipheriv('aes-256-gcm', key, iv) : null

    const sink = new Writable({
      write(chunk, _enc, cb) {
        put(chunk).then(() => cb(), cb)
      },
    })

    if (cipher) gzip.pipe(cipher).pipe(sink)
    else gzip.pipe(sink)

    say({ phase: '打包', done: 0, total })

    let done = 0
    let lastTick = 0
    for (const e of entries) {
      const p = Buffer.from(e.rel.replace(/\\/g, '/'), 'utf8')
      const head = Buffer.concat([u32(p.length), p, u64(e.size)])
      if (!gzip.write(head)) await once(gzip, 'drain')
      await pipeExactly(e.abs, e.size, gzip)

      done++
      const now = Date.now()
      if (now - lastTick > 200) {
        lastTick = now
        say({ phase: '打包', done, total, note: e.rel })
      }
    }

    say({ phase: '收尾', done, total, note: '压缩并写入…' })
    gzip.end()
    await finished(sink)

    if (cipher) await put(cipher.getAuthTag())
  } finally {
    await fh.close()
  }

  const st = await fs.stat(target)

  // ---- 清单：包里到底有什么，不加密，随时能看 ----
  await fs.writeFile(
    path.join(targetDir, '清单.json'),
    JSON.stringify(
      {
        ...manifest,
        bytesOnDisk: st.size,
        files: plan.entries.map((e) => e.rel.replace(/\\/g, '/')),
      },
      null,
      2,
    ),
    'utf8',
  )

  // ---- 说明：给半年后的人看 ----
  await writeReadme({
    dir: targetDir,
    manifest,
    packFile: fileName,
    packBytes: st.size,
    groups: plan.groups,
  })

  say({ phase: '完成', done: total, total })

  return {
    dir: targetDir,
    target,
    bytes: st.size,
    encrypted,
    host,
    entries: total,
  }
}
