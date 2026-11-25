// 搬家 · 宿主半边
//
// 浏览器那边不能随便写盘，所以真正的活在 Node 这边干：
//   GET  /dsh-move/state   这台机器上有什么可搬的（扫一遍，缓存 60 秒）
//   POST /dsh-move/export  开始打包，立刻返回 jobId，活儿在后台跑
//   GET  /dsh-move/job     查进度
//
// 为什么用 job 而不是同步返回：345MB 要跑一分多钟，
// 浏览器等不起，DSH 的 webServer 也不该被一个请求占那么久。

import { buildPlan, defaultOutDir, makeStamp, human } from './plan.js'
import { pack } from './pack.js'

export const name = 'move'
export const inject = ['webServer']

const STATE_TTL = 60_000

let planCache = null
let planCacheAt = 0

/** 同时只允许一个打包任务。两个一起跑会互相抢盘，谁也快不了。 */
let running = null
const jobs = new Map()

const json = (res, code, body) => {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 64 * 1024) raw = raw.slice(0, 64 * 1024)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })

async function getPlan(force = false) {
  const now = Date.now()
  if (!force && planCache && now - planCacheAt < STATE_TTL) return planCache
  planCache = await buildPlan()
  planCacheAt = now
  return planCache
}

function snapshot(job) {
  if (!job) return null
  return {
    id: job.id,
    state: job.state, // running | done | error
    phase: job.phase,
    done: job.done,
    total: job.total,
    note: job.note || '',
    startedAt: job.startedAt,
    endedAt: job.endedAt || null,
    error: job.error || null,
    result: job.result || null,
    log: job.log.slice(-6),
  }
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-move/state',
      handler: async (req, res) => {
        try {
          const force = /[?&]refresh=1/.test(req.url || '')
          const plan = await getPlan(force)
          json(res, 200, {
            ok: true,
            home: plan.home,
            groups: plan.groups,
            totals: {
              files: plan.totals.files,
              bytes: plan.totals.bytes,
              human: human(plan.totals.bytes),
            },
            skipped: plan.skipped.slice(0, 50),
            skippedCount: plan.skipped.length,
            defaultOut: defaultOutDir(makeStamp()),
            stamp: makeStamp(),
            busy: running ? running : null,
          })
        } catch (e) {
          json(res, 500, { ok: false, error: String((e && e.message) || e) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-move/export',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: '只收 POST' })
        if (running) {
          return json(res, 409, { ok: false, error: '已经有一份在打包了，等它跑完', job: running })
        }

        const body = await readBody(req)
        const outDir = String(body.outDir || '').trim() || defaultOutDir(makeStamp())
        const password = typeof body.password === 'string' ? body.password : ''
        const stamp = makeStamp()

        let plan
        try {
          plan = await getPlan(true)
        } catch (e) {
          return json(res, 500, { ok: false, error: '扫描失败：' + ((e && e.message) || e) })
        }

        if (!plan.totals.files) {
          return json(res, 400, { ok: false, error: '没扫到可打包的内容' })
        }

        const id = `${Date.now().toString(36)}`
        const job = {
          id,
          state: 'running',
          phase: '准备',
          done: 0,
          total: plan.totals.files,
          note: '',
          startedAt: new Date().toISOString(),
          endedAt: null,
          error: null,
          result: null,
          log: [],
        }
        jobs.set(id, job)
        running = id

        // 后台跑，立刻回话
        ;(async () => {
          try {
            const r = await pack({
              outDir,
              password,
              plan,
              stamp,
              onProgress: (p) => {
                job.phase = p.phase
                job.done = p.done
                job.total = p.total
                job.note = p.note || ''
                if (p.note) {
                  const line = `${p.phase} · ${p.note}`
                  if (!job.log.length || job.log[job.log.length - 1] !== line) {
                    job.log.push(line)
                    if (job.log.length > 40) job.log.shift()
                  }
                }
              },
            })
            job.state = 'done'
            job.phase = '完成'
            job.endedAt = new Date().toISOString()
            job.result = {
              dir: r.dir,
              target: r.target,
              bytes: r.bytes,
              human: human(r.bytes),
              encrypted: r.encrypted,
              entries: r.entries,
            }
          } catch (e) {
            job.state = 'error'
            job.endedAt = new Date().toISOString()
            job.error = String((e && e.message) || e)
          } finally {
            running = null
            // 只留最近 8 条，免得一直在内存里攒
            const keys = [...jobs.keys()]
            while (keys.length > 8) jobs.delete(keys.shift())
          }
        })()

        json(res, 200, { ok: true, job: snapshot(job) })
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-move/job',
      handler: async (req, res) => {
        const m = /[?&]id=([^&]+)/.exec(req.url || '')
        const id = m ? decodeURIComponent(m[1]) : ''
        if (!id) {
          return json(res, 400, { ok: false, error: '缺少 id', busy: running })
        }
        const job = jobs.get(id)
        if (!job) return json(res, 404, { ok: false, error: '没有这个任务' })
        json(res, 200, { ok: true, job: snapshot(job) })
      },
    }),
  )

  ctx.effect(() => () => {
    // 插件卸载时别留后台任务
    running = null
    jobs.clear()
  })
}
