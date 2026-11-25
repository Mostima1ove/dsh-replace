// 导入端自测：造两台"机器"，一台打包、一台导入，逐个断言。
//   node test_import.mjs
//
// 会话文件是真的多帧 zstd（和 DSH 写出来的一样），不是随便塞一个字符串——
// 因为路径适配只重写第一帧，得拿真结构才测得出来。

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { pack } from './lib/pack.js'
import { buildPlan } from './lib/plan.js'
import { importPack, missingPlugins } from './lib/import.js'
import { encodeKey } from './lib/adapt.js'

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dshmove-imp-'))
const src = path.join(tmp, 'src-home')
const dst = path.join(tmp, 'dst-home')
const out = path.join(tmp, 'out')
const fb = path.join(tmp, 'fallback')

const OLD_CWD = 'Q:\\不存在的盘\\作品集'

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
const read = (p) => fs.readFile(p, 'utf8').catch(() => null)
const exists = async (p) => {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** 和 DSH 一样：元数据一帧，后面每批一帧。 */
function sessionBytes(cwd, body = '{"type":"turn/start"}\n') {
  const meta =
    JSON.stringify({ type: 'session', version: 4, id: 's-1', createdAt: 1790000000000, cwd, isSeeded: false }) + '\n'
  return Buffer.concat([
    zlib.zstdCompressSync(Buffer.from(meta, 'utf8')),
    zlib.zstdCompressSync(Buffer.from(body, 'utf8')),
  ])
}

async function makeFile(root, rel, content) {
  const p = path.join(root, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, content)
  return p
}

try {
  // ---------- 源机器 ----------
  await makeFile(src, 'fish-memory/session-1.json', '{"mood":"quiet"}')
  await makeFile(src, 'fish-memory/session-2.json', '{"mood":"loud"}')
  await makeFile(src, 'whale-persona/persona.md', '# 人设\n')
  await makeFile(
    src,
    `sessions/${encodeKey(OLD_CWD)}/s-uuid-1/session.v4.jsonl.zstd`,
    sessionBytes(OLD_CWD, '{"type":"turn/start"}\n{"type":"turn/end"}\n'),
  )
  await makeFile(
    src,
    'profiles/desktop/package.json',
    JSON.stringify(
      {
        name: 'dsh-profile',
        dependencies: { 'dsh-a': '1.0.0', 'dsh-b': '2.0.0' },
        dsh: { profile: { bundles: ['dsh-a', 'dsh-b'] } },
      },
      null,
      2,
    ),
  )
  await makeFile(src, 'profiles/desktop/pnpm-lock.yaml', 'lockfileVersion: 9\n')

  process.env.DSH_HOME = src
  const plan = await buildPlan()
  ok('扫描到文件', plan.entries.length >= 5, plan.entries.length)
  ok('扫到插件名单', plan.plugins && plan.plugins.bundles.includes('dsh-b'))
  ok('扫到工作区', plan.workspaces.length === 1, plan.workspaces)
  ok('工作区路径是从会话里读出来的', plan.workspaces[0]?.cwd === OLD_CWD, plan.workspaces[0])
  ok('工作区没被标成"猜的"', plan.workspaces[0]?.guessed === false)

  const packed = await pack({ outDir: out, password: 'maijia2026', plan, stamp: 'T' })
  ok('打出包', await exists(packed.target))

  // ---------- 目标机器：故意先放几个会被撞上的 ----------
  await makeFile(dst, 'fish-memory/session-1.json', '{"mood":"MINE"}')
  await makeFile(dst, 'fish-memory/session-2.json', '{"mood":"loud"}')
  await makeFile(dst, 'fish-memory/only-here.json', '{"keep":true}')
  await makeFile(
    dst,
    'profiles/desktop/package.json',
    JSON.stringify(
      {
        name: 'dsh-profile',
        dependencies: { 'dsh-a': '9.9.9', 'dsh-local': '1.0.0' },
        dsh: { profile: { bundles: ['dsh-a', 'dsh-local'] } },
      },
      null,
      2,
    ),
  )

  // ---------- 错密码 ----------
  let rejected = false
  try {
    await importPack({ packPath: packed.target, password: 'wrong', home: dst, fallbackRoot: fb })
  } catch (e) {
    rejected = /密码不对/.test(e.message)
  }
  ok('错密码被拒', rejected)

  // ---------- 正常导入 ----------
  const t0 = Date.now()
  const res = await importPack({ packPath: packed.target, password: 'maijia2026', home: dst, fallbackRoot: fb })
  const ms = Date.now() - t0

  // 文件层面
  ok('会话文件被写入过', res.report.written.some((r) => r.includes('session.v4.jsonl.zstd')), res.report.written)
  ok('人设写进来了', (await read(path.join(dst, 'whale-persona/persona.md'))) === '# 人设\n')
  ok('冲突文件被覆盖成包里的', (await read(path.join(dst, 'fish-memory/session-1.json'))) === '{"mood":"quiet"}')
  ok('被顶掉的那份留了备份', (await read(path.join(dst, 'fish-memory/session-1.json.bak-' + res.report.tag))) === '{"mood":"MINE"}')
  ok('同内容不产生备份', !(await exists(path.join(dst, 'fish-memory/session-2.json.bak-' + res.report.tag))))
  ok('本机独有的文件没被删', (await read(path.join(dst, 'fish-memory/only-here.json'))) === '{"keep":true}')

  // package.json 合并
  const pkg = JSON.parse(await read(path.join(dst, 'profiles/desktop/package.json')))
  ok('包里的 bundle 加进来了', pkg.dsh.profile.bundles.includes('dsh-b'))
  ok('本机的 bundle 还在', pkg.dsh.profile.bundles.includes('dsh-local'))
  ok('本机同名依赖版本没被改', pkg.dependencies['dsh-a'] === '9.9.9')
  ok('包里独有的依赖加进来了', pkg.dependencies['dsh-b'] === '2.0.0')
  ok('lock 文件没搬过来', !(await exists(path.join(dst, 'profiles/desktop/pnpm-lock.yaml'))))

  // ---------- 路径适配 ----------
  const w = res.report.workspaces[0]
  ok('适配记录里有这条工作区', !!w, res.report.workspaces)
  ok('判定为"改落点"（Q 盘不存在）', w.how === '改落点', w)
  ok('新路径落在 fallback 下', w.now.startsWith(fb), w.now)
  ok('新工作区目录建好了', await exists(w.now))
  ok('会话目录改成了新 key', await exists(path.join(dst, 'sessions', encodeKey(w.now), 's-uuid-1', 'session.v4.jsonl.zstd')))
  ok('旧 key 目录已经不在了', !(await exists(path.join(dst, 'sessions', encodeKey(OLD_CWD)))))

  // 第一帧 cwd 改成新路径，后面内容不变
  const sessFile = path.join(dst, 'sessions', encodeKey(w.now), 's-uuid-1', 'session.v4.jsonl.zstd')
  const buf = await fs.readFile(sessFile)
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const second = buf.indexOf(MAGIC, 4)
  const firstTxt = zlib.zstdDecompressSync(buf.subarray(0, second)).toString('utf8')
  const firstObj = JSON.parse(firstTxt.split('\n')[0])
  const restTxt = zlib.zstdDecompressSync(buf.subarray(second)).toString('utf8')
  ok('第一帧的 cwd 改成了新路径', firstObj.cwd === w.now, firstObj.cwd)
  ok('第一帧其它字段没动', firstObj.id === 's-1' && firstObj.version === 4)
  ok('后面的帧原样保留', restTxt === '{"type":"turn/start"}\n{"type":"turn/end"}\n', restTxt)

  // 缺插件
  const miss = missingPlugins({
    manifest: res.manifest,
    localPkg: { dsh: { profile: { bundles: ['dsh-a', 'dsh-local'] } } },
  })
  ok('认出没装的插件', miss.length === 1 && miss[0] === 'dsh-b', miss)

  console.log('')
  console.log(`  统计：写入 ${res.totals.written} / 覆盖 ${res.totals.replaced} / 没动 ${res.totals.skipped} / 失败 ${res.totals.failed}`)
  console.log(`  路径：${w.old}  →  ${w.now}（${w.how}）`)
  console.log(`  用时 ${ms}ms`)
} catch (e) {
  fail++
  console.log('  ✗ 抛异常：', e && e.stack)
} finally {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
}

console.log('')
console.log(fail === 0 ? `全部通过（${pass} 项）` : `${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
