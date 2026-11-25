// 搬家 · 解包
//
// 读取 pack.js 产出的 .dshpack。这一版只做「把文件原样倒出来」，
// 不判断版本、不合并配置——那些是导入端的事，等包本身验过了再说。

import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { MAGIC, PACK_EXT } from './pack.js'

const TAG_LEN = 16

/**
 * 顺序读一个流，按字节数取。解压出来的数据是碎块，这里负责攒够再给。
 * 用队列而不是每次 concat，否则解一个大文件就是 O(n²)。
 */
class ByteReader {
  constructor(stream, getError) {
    this.it = stream[Symbol.asyncIterator]()
    this.queue = []
    this.live = 0
    this.ended = false
    this.getError = getError || (() => null)
  }

  async fill(n) {
    while (this.live < n && !this.ended) {
      const err = this.getError()
      if (err) throw err
      const { value, done } = await this.it.next()
      if (done) {
        this.ended = true
        break
      }
      if (value && value.length) {
        this.queue.push(value)
        this.live += value.length
      }
    }
    const after = this.getError()
    if (after && this.live < n) throw after
  }

  async take(n) {
    if (n === 0) return Buffer.alloc(0)
    await this.fill(n)
    if (this.live < n) throw new Error('包不完整：数据提前结束了')

    if (this.queue[0].length >= n) {
      const out = this.queue[0].subarray(0, n)
      this.queue[0] = this.queue[0].subarray(n)
      if (!this.queue[0].length) this.queue.shift()
      this.live -= n
      return out
    }

    const parts = []
    let need = n
    while (need > 0) {
      const c = this.queue[0]
      if (c.length <= need) {
        parts.push(c)
        this.queue.shift()
        need -= c.length
      } else {
        parts.push(c.subarray(0, need))
        this.queue[0] = c.subarray(need)
        need = 0
      }
    }
    this.live -= n
    return Buffer.concat(parts)
  }
}

/** 相对路径安全检查：不许跳出目标目录。 */
function safeJoin(root, rel) {
  const norm = path.normalize(rel).replace(/^([/\\])+/, '')
  const abs = path.join(root, norm)
  const rootAbs = path.resolve(root)
  if (!path.resolve(abs).startsWith(rootAbs + path.sep) && path.resolve(abs) !== rootAbs) {
    throw new Error(`包里有非法路径：${rel}`)
  }
  return abs
}

/**
 * 解包。
 *
 * @param {object} opts
 * @param {string} opts.packPath  .dshpack 路径
 * @param {string} [opts.password]
 * @param {string} opts.outDir    解到哪
 * @param {(p:{done:number,total:number,note?:string})=>void} [opts.onProgress]
 */
export async function unpack({ packPath, password, outDir, onProgress }) {
  const say = (p) => {
    try {
      onProgress && onProgress(p)
    } catch {
      /* ignore */
    }
  }

  const fh = await fs.open(packPath, 'r')
  let manifest
  let dataStart
  let dataEnd
  let salt = null
  let iv = null
  let tag = null

  try {
    const st = await fh.stat()
    const total = st.size

    const M = MAGIC.length
    const head = Buffer.alloc(M)
    await fh.read(head, 0, M, 0)
    if (!head.equals(MAGIC)) {
      throw new Error('这不是搬家包（文件头对不上）')
    }

    const lenBuf = Buffer.alloc(4)
    await fh.read(lenBuf, 0, 4, M)
    const mlen = lenBuf.readUInt32LE(0)
    if (mlen > 16 * 1024 * 1024) throw new Error('包头长度不合理，文件可能坏了')

    const mBuf = Buffer.alloc(mlen)
    await fh.read(mBuf, 0, mlen, M + 4)
    try {
      manifest = JSON.parse(mBuf.toString('utf8'))
    } catch {
      throw new Error('包头不是合法 JSON，文件可能坏了')
    }

    let cursor = M + 4 + mlen
    if (manifest.encrypted) {
      salt = Buffer.alloc(16)
      await fh.read(salt, 0, 16, cursor)
      cursor += 16
      iv = Buffer.alloc(12)
      await fh.read(iv, 0, 12, cursor)
      cursor += 12

      tag = Buffer.alloc(TAG_LEN)
      await fh.read(tag, 0, TAG_LEN, total - TAG_LEN)
      dataEnd = total - TAG_LEN
    } else {
      dataEnd = total
    }
    dataStart = cursor
  } finally {
    await fh.close()
  }

  let derivedKey = null
  if (manifest.encrypted) {
    if (!password) throw new Error('这个包是加密的，需要密码')
    const kdf = manifest.kdf || {}
    derivedKey = crypto.pbkdf2Sync(
      Buffer.from(password, 'utf8'),
      salt,
      kdf.iterations || 100000,
      32,
      kdf.hash || 'sha256',
    )
    // 先做密码体检。做这一步是为了「错得早」：不然后面会解出一堆垃圾数据，
    // 报出来的错是「路径长得离谱」这种，跟密码完全对不上号。
    if (manifest.check) {
      const want = crypto
        .createHmac('sha256', derivedKey)
        .update('dsh-move-v1')
        .digest('hex')
      if (want !== manifest.check) throw new Error('密码不对')
    }
  }

  // ---- 数据流 ----
  const raw = createReadStream(packPath, {
    start: dataStart,
    end: dataEnd - 1,
    highWaterMark: 1 << 20,
  })

  let source = raw
  let streamError = null
  // 这三条链上的 error 必须有人接，否则 Node 会当成未处理事件把进程带走。
  const keep = (s) => {
    s.on('error', (e) => {
      if (!streamError) streamError = e
    })
  }
  keep(raw)

  if (manifest.encrypted) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv)
    decipher.setAuthTag(tag)
    keep(decipher)
    source = raw.pipe(decipher)
  }

  const gunzip = zlib.createGunzip()
  keep(gunzip)
  source.pipe(gunzip)

  const reader = new ByteReader(gunzip, () => streamError)
  const declared = manifest.entries || 0

  let done = 0
  let bytes = 0
  const written = []

  try {
    for (let i = 0; i < declared; i++) {
      const plenBuf = await reader.take(4)
      const plen = plenBuf.readUInt32LE(0)
      if (plen > 8192) throw new Error('包里的路径长得离谱，文件可能坏了')

      const rel = (await reader.take(plen)).toString('utf8')
      const sizeBuf = await reader.take(8)
      const size = Number(sizeBuf.readBigUInt64LE(0))

      const content = await reader.take(size)
      const abs = safeJoin(outDir, rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content)

      written.push(rel)
      bytes += size
      done++
      if (done % 100 === 0) say({ done, total: declared, note: rel })
    }
  } catch (e) {
    // 半截数据比没有更害人：清干净
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {})
    const msg = String((e && e.message) || e)
    if (/auth|tag|BAD_DECRYPT|Unsupported state/i.test(msg)) {
      throw new Error('密码不对，或者包在传输中被改坏了')
    }
    throw e
  }

  return { files: done, bytes, manifest, written }
}
