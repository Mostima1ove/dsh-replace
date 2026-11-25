// 工作区路径适配。
//
// 三件事：
//   1. 读旧机器上每个工作区到底是谁（权威来源 = 会话文件第一帧里的 cwd，不是目录名）
//   2. 决定在**新机器**上它该落在哪
//   3. 需要改的时候，只重写会话文件的**第一帧**（元数据那 200 字节），后面几千帧一个字节不动
//
// 为什么不用目录名反解：`D:\阁楼\DS-work` 编码成 `--D-~9601~697C-DS-work--`，
// 里面的 `-` 既可能是路径分隔符，也可能是原名自带的（DS-work）。
// 反解必然出错，所以只做正向编码。

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 路径 → 会话目录名。`D:\阁楼\DS-work` → `--D-~9601~697C-DS-work--` */
export function encodeKey(p) {
  const drive = p[0]
  const body = p.slice(3).replace(/\\/g, '-')
  let out = drive + '-'
  for (const ch of body) {
    out += ch.charCodeAt(0) > 127 ? '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') : ch
  }
  return '--' + out + '--'
}

/** 只解第一帧，拿里面的 cwd。会话文件是几千个 zstd 帧拼接的追加式文件。 */
export function firstFrameCwd(file) {
  const buf = fs.readFileSync(file)
  if (buf.indexOf(MAGIC) !== 0) return null
  const second = buf.indexOf(MAGIC, 4)
  const first = buf.subarray(0, second === -1 ? buf.length : second)
  const txt = zlib.zstdDecompressSync(first).toString('utf8')
  const line = txt.split('\n')[0]
  try {
    return JSON.parse(line).cwd || null
  } catch {
    return null
  }
}

/**
 * 扫出这台机器上有哪些工作区。
 * 返回 [{ key, cwd, sessions }]，key 是目录名，cwd 是从会话里读到的真路径。
 */
export async function readWorkspaces(home) {
  const root = path.join(home, 'sessions')
  let dirs = []
  try {
    dirs = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const out = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const key = d.name
    const dir = path.join(root, key)
    let subs = []
    try {
      subs = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    let cwd = null
    let sessions = 0
    for (const s of subs) {
      if (!s.isDirectory()) continue
      sessions++
      if (cwd) continue
      const file = path.join(dir, s.name, 'session.v4.jsonl.zstd')
      try {
        cwd = firstFrameCwd(file)
      } catch {
        /* 这一条读不出来就试下一条 */
      }
    }

    // 一条会话都没有的目录，才退回用目录名猜（猜错了也只是空目录，没内容可坏）
    out.push({ key, cwd: cwd || decodeGuess(key), sessions, guessed: !cwd })
  }
  return out
}

/** 兜底：只在没有任何会话可读时用。含 `-` 的路段会被解错，所以只当参考。 */
function decodeGuess(key) {
  let s = key
  if (s.startsWith('--')) s = s.slice(2)
  if (s.endsWith('--')) s = s.slice(0, -2)
  if (!/^[A-Za-z]-/.test(s)) return s
  let out = s[0] + ':\\'
  let i = 2
  while (i < s.length) {
    const c = s[i]
    if (c === '~') {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16))
      i += 5
    } else if (c === '-') {
      out += '\\'
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

/**
 * 把旧路径落到新机器上。
 * 返回 { path, how, mkdir }
 *   how: '原样' | '建目录' | '改落点'
 */
export function adaptPath(oldPath, { fallbackRoot }) {
  if (exists(oldPath)) return { path: oldPath, how: '原样', mkdir: false }

  const drive = oldPath.slice(0, 2)
  if (/^[A-Za-z]:$/.test(drive) && exists(drive + '\\')) {
    return { path: oldPath, how: '建目录', mkdir: true }
  }

  // 盘符在新机器上不存在，只能换个地方落。
  const seg = oldPath.replace(/^[A-Za-z]:[\\/]/, '').replace(/[\\/]/g, '-') || 'workspace'
  const fallback = path.join(fallbackRoot, seg)
  return { path: fallback, how: '改落点', mkdir: true }
}

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

/**
 * 改一个会话文件的 cwd，只重写第一帧。
 * 返回 true = 改了，false = 本来就是它 / 文件不是预期的形状。
 */
export function rewriteSessionCwd(file, newCwd) {
  let buf
  try {
    buf = fs.readFileSync(file)
  } catch {
    return false
  }
  if (buf.indexOf(MAGIC) !== 0) return false

  const second = buf.indexOf(MAGIC, 4)
  const firstEnd = second === -1 ? buf.length : second
  const first = buf.subarray(0, firstEnd)
  const rest = buf.subarray(firstEnd)

  let txt
  try {
    txt = zlib.zstdDecompressSync(first).toString('utf8')
  } catch {
    return false
  }

  const nl = txt.indexOf('\n')
  const head = nl === -1 ? txt : txt.slice(0, nl)
  const tail = nl === -1 ? '' : txt.slice(nl)

  let obj
  try {
    obj = JSON.parse(head)
  } catch {
    return false
  }
  if (obj.cwd === newCwd) return false

  obj.cwd = newCwd
  const rebuilt = zlib.zstdCompressSync(Buffer.from(JSON.stringify(obj) + tail, 'utf8'))
  fs.writeFileSync(file, Buffer.concat([rebuilt, rest]))
  return true
}

/**
 * 把一个工作区目录下的所有会话都改到新路径，然后把目录改名成新 key。
 * 返回 { renamed, sessions }
 */
export async function adaptWorkspace(home, { oldKey, oldCwd, newCwd }) {
  const root = path.join(home, 'sessions')
  const dir = path.join(root, oldKey)

  let subs = []
  try {
    subs = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return { renamed: false, sessions: 0 }
  }

  let sessions = 0
  for (const s of subs) {
    if (!s.isDirectory()) continue
    const file = path.join(dir, s.name, 'session.v4.jsonl.zstd')
    if (rewriteSessionCwd(file, newCwd)) sessions++
  }

  const newKey = encodeKey(newCwd)
  if (newKey === oldKey) return { renamed: false, sessions }

  let target = path.join(root, newKey)
  if (exists(target)) {
    // 新 key 已经有人占了：把里面的会话挪过去
    const taken = await fsp.readdir(dir, { withFileTypes: true })
    for (const s of taken) {
      if (!s.isDirectory()) continue
      let dest = path.join(target, s.name)
      if (exists(dest)) dest = path.join(target, s.name + '-from-old')
      await fsp.rename(path.join(dir, s.name), dest).catch(() => {})
    }
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  } else {
    await fsp.rename(dir, target).catch(() => {})
  }
  return { renamed: true, sessions, newKey }
}
