/**
 * dsh-move —— 浏览器半边（设置里的「搬家」一页）
 *
 * 自注册脚本，约定和别的 DSH 插件一样：
 *   window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 *
 * 这一页只做一件事：把「这台机器上的 DSH 打个包带走」变成点两下。
 * 真正的活在宿主那边（lib/index.js），这里只管显示和发指令。
 */
window.__ModuleLoader__.load({
  id: 'dsh-move',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-move'

    const CSS = `
[data-mv-wrap]{display:flex;flex-direction:column;gap:16px;max-width:680px;}
[data-mv-head]{font-size:13px;line-height:1.75;opacity:.78;}
[data-mv-card]{border-radius:12px;background:rgba(127,127,127,.06);padding:14px 16px;}
[data-mv-title]{font-size:12px;letter-spacing:.08em;opacity:.5;margin-bottom:10px;}
[data-mv-grp]{display:flex;align-items:baseline;gap:10px;font-size:12.5px;line-height:2;}
[data-mv-grp-name]{flex:1;min-width:0;opacity:.85;}
[data-mv-grp-n]{flex:0 0 62px;text-align:right;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;opacity:.55;}
[data-mv-grp-s]{flex:0 0 78px;text-align:right;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;opacity:.75;}
[data-mv-total]{display:flex;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(127,127,127,.18);font-size:13px;font-weight:600;}
[data-mv-total span:last-child]{margin-left:auto;font-family:ui-monospace,Consolas,monospace;}
[data-mv-field]{display:flex;flex-direction:column;gap:6px;}
[data-mv-label]{font-size:12px;opacity:.6;}
[data-mv-input]{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;border:1px solid rgba(127,127,127,.32);background:transparent;color:inherit;font-size:12.5px;font-family:ui-monospace,Consolas,monospace;}
[data-mv-input]:focus{outline:none;border-color:rgba(90,170,120,.75);}
[data-mv-btn]{align-self:flex-start;padding:9px 20px;border-radius:9px;border:1px solid rgba(127,127,127,.35);background:rgba(90,170,120,.16);color:inherit;font-size:13px;font-weight:600;cursor:pointer;}
[data-mv-btn]:hover:not(:disabled){background:rgba(90,170,120,.26);}
[data-mv-btn]:disabled{opacity:.45;cursor:not-allowed;}
[data-mv-btn][data-ghost]{background:transparent;font-weight:400;}
[data-mv-confirm]{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 14px;border-radius:10px;background:rgba(220,170,80,.12);font-size:12.5px;line-height:1.7;}
[data-mv-bar]{height:6px;border-radius:999px;background:rgba(127,127,127,.18);overflow:hidden;}
[data-mv-bar-in]{height:100%;background:rgba(90,170,120,.85);transition:width .3s ease;}
[data-mv-prog]{display:flex;flex-direction:column;gap:8px;}
[data-mv-prog-line]{display:flex;gap:10px;font-size:12px;opacity:.75;}
[data-mv-prog-line span:last-child]{margin-left:auto;font-family:ui-monospace,Consolas,monospace;}
[data-mv-note]{font-size:11.5px;opacity:.5;font-family:ui-monospace,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
[data-mv-path]{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.7;word-break:break-all;opacity:.9;user-select:all;}
[data-mv-msg]{font-size:12px;min-height:18px;opacity:.8;}
[data-mv-msg][data-err]{color:#e2706f;}
[data-mv-ok]{color:rgba(90,170,120,.95);}
`

    const getJson = async (url) => {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      return res.json()
    }

    const mb = (bytes) => {
      const n = bytes / 1024 / 1024
      return n >= 1024 ? (n / 1024).toFixed(2) + ' GB' : n.toFixed(1) + ' MB'
    }

    function Panel() {
      const [st, setSt] = React.useState(null)
      const [outDir, setOutDir] = React.useState('')
      const [pwd, setPwd] = React.useState('')
      const [confirming, setConfirming] = React.useState(false)
      const [job, setJob] = React.useState(null)
      const [msg, setMsg] = React.useState('')
      const [err, setErr] = React.useState(false)

      const load = React.useCallback(async (force) => {
        try {
          const s = await getJson(API + '/state' + (force ? '?refresh=1' : ''))
          if (s && s.ok) {
            setSt(s)
            setOutDir((prev) => prev || s.defaultOut)
            if (s.busy) setJob({ id: s.busy, state: 'running' })
          } else {
            setErr(true)
            setMsg('读不到清单：' + ((s && s.error) || '未知'))
          }
        } catch (e) {
          setErr(true)
          setMsg('读不到清单：' + ((e && e.message) || e))
        }
      }, [])

      React.useEffect(() => {
        load(false)
      }, [load])

      // 打包中：轮询进度
      React.useEffect(() => {
        if (!job || !job.id || job.state !== 'running') return
        let alive = true
        const tick = async () => {
          if (!alive) return
          try {
            const r = await getJson(API + '/job?id=' + encodeURIComponent(job.id))
            if (!alive) return
            if (r && r.ok && r.job) {
              setJob(r.job)
              if (r.job.state !== 'running') {
                if (r.job.state === 'done') {
                  setErr(false)
                  setMsg('打包完成')
                } else {
                  setErr(true)
                  setMsg('打包失败：' + (r.job.error || '未知'))
                }
                load(true)
                return
              }
            }
          } catch {
            /* 一次没查到不算事，下一轮接着来 */
          }
          setTimeout(tick, 700)
        }
        const timer = setTimeout(tick, 700)
        return () => {
          alive = false
          clearTimeout(timer)
        }
      }, [job && job.id, job && job.state, load])

      const start = async () => {
        setConfirming(false)
        setErr(false)
        setMsg('正在打包…')
        try {
          const res = await fetch(API + '/export', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ outDir, password: pwd }),
          })
          const r = await res.json()
          if (r && r.ok) {
            setJob(r.job)
          } else {
            setErr(true)
            setMsg('没能开始：' + ((r && r.error) || res.status))
          }
        } catch (e) {
          setErr(true)
          setMsg('没能开始：' + ((e && e.message) || e))
        }
      }

      if (!st) {
        return h('div', { 'data-mv-wrap': '' }, h('div', { 'data-mv-head': '' }, '正在看这台机器上有什么…'))
      }

      const running = job && job.state === 'running'
      const pct = running && job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0
      const done = job && job.state === 'done' && job.result

      return h(
        'div',
        { 'data-mv-wrap': '' },
        h(
          'div',
          { 'data-mv-head': '' },
          '把会话、插件、技能、人设打成一份包，拷到另一台电脑上接着用。',
        ),

        // 清单
        h(
          'div',
          { 'data-mv-card': '' },
          h('div', { 'data-mv-title': '' }, '要带走的东西'),
          ...st.groups.map((g) =>
            h(
              'div',
              { 'data-mv-grp': '', key: g.key },
              h('span', { 'data-mv-grp-name': '' }, g.label),
              h('span', { 'data-mv-grp-n': '' }, g.files + ' 个'),
              h('span', { 'data-mv-grp-s': '' }, mb(g.bytes)),
            ),
          ),
          h(
            'div',
            { 'data-mv-total': '' },
            h('span', {}, '合计'),
            h('span', {}, st.totals.files + ' 个文件'),
            h('span', {}, st.totals.human),
          ),
        ),

        // 输出位置
        h(
          'div',
          { 'data-mv-field': '' },
          h('div', { 'data-mv-label': '' }, '存到哪'),
          h('input', {
            'data-mv-input': '',
            value: outDir,
            disabled: running,
            spellCheck: false,
            onChange: (e) => setOutDir(e.target.value),
            placeholder: st.defaultOut,
          }),
        ),

        // 密码
        h(
          'div',
          { 'data-mv-field': '' },
          h('div', { 'data-mv-label': '' }, '密码'),
          h('input', {
            'data-mv-input': '',
            type: 'password',
            value: pwd,
            disabled: running,
            autoComplete: 'new-password',
            onChange: (e) => setPwd(e.target.value),
          }),
        ),

        // 开始 / 确认
        running
          ? h(
              'div',
              { 'data-mv-prog': '' },
              h(
                'div',
                { 'data-mv-bar': '' },
                h('div', { 'data-mv-bar-in': '', style: { width: pct + '%' } }),
              ),
              h(
                'div',
                { 'data-mv-prog-line': '' },
                h('span', {}, job.phase || '打包中'),
                h('span', {}, `${job.done} / ${job.total}`),
              ),
              job.note ? h('div', { 'data-mv-note': '' }, job.note) : null,
              h(
                'div',
                { 'data-mv-head': '' },
                '慢一点没关系，它不会动你现在的会话。',
              ),
            )
          : confirming
            ? h(
                'div',
                { 'data-mv-confirm': '' },
                h('span', {}, '打包期间请尽量不要使用 DSH，几分钟就好。'),
                h(
                  'button',
                  { 'data-mv-btn': '', onClick: start },
                  '那就开始',
                ),
                h(
                  'button',
                  { 'data-mv-btn': '', 'data-ghost': '', onClick: () => setConfirming(false) },
                  '再等等',
                ),
              )
            : h(
                'button',
                {
                  'data-mv-btn': '',
                  disabled: !st.totals.files,
                  onClick: () => {
                    setErr(false)
                    setMsg('')
                    setConfirming(true)
                  },
                },
                '打包带走',
              ),

        // 完成
        done
          ? h(
              'div',
              { 'data-mv-card': '' },
              h('div', { 'data-mv-title': '' }, '打好了'),
              h('div', { 'data-mv-path': '' }, job.result.dir),
              h(
                'div',
                { 'data-mv-grp': '' },
                h('span', { 'data-mv-grp-name': '' }, '包大小'),
                h('span', { 'data-mv-grp-s': '' }, job.result.human),
              ),
              h(
                'button',
                {
                  'data-mv-btn': '',
                  'data-ghost': '',
                  style: { marginTop: '10px' },
                  onClick: () => {
                    try {
                      navigator.clipboard.writeText(job.result.dir)
                      setErr(false)
                      setMsg('路径已复制')
                    } catch {
                      setMsg('复制不了，手选一下吧')
                    }
                  },
                },
                '复制路径',
              ),
            )
          : null,

        h(
          'div',
          { 'data-mv-msg': '', 'data-err': err ? '' : undefined },
          msg ? h('span', { 'data-mv-ok': err ? undefined : '' }, msg) : '',
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-move')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-move: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () =>
          slots.register({ name: 'settings.section', id: 'move', order: 56, label: '搬家' }, () =>
            h(Panel),
          ),
        )
      },
    }
  },
})
