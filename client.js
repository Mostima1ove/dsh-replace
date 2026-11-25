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
[data-mv-sep]{display:flex;align-items:center;gap:12px;font-size:11.5px;letter-spacing:.06em;opacity:.45;margin:6px 0 0;}
[data-mv-sep]:before,[data-mv-sep]:after{content:"";height:1px;flex:1;background:rgba(127,127,127,.28);}
[data-mv-file]{font-size:12px;color:inherit;max-width:100%;}
[data-mv-file]::file-selector-button{margin-right:10px;padding:7px 14px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:12px;cursor:pointer;}
[data-mv-file]::file-selector-button:hover{background:rgba(127,127,127,.1);}
[data-mv-kv]{display:flex;gap:10px;font-size:12.5px;line-height:1.9;opacity:.85;}
[data-mv-kv b]{font-weight:600;}
[data-mv-kv span:last-child]{margin-left:auto;font-family:ui-monospace,Consolas,monospace;}
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
      const [file, setFile] = React.useState(null)
      const [pwd2, setPwd2] = React.useState('')
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

      // 导入：包直接当 body 传上去。浏览器会边读边发，三百兆也不用整份读进内存。
      // 密码走 query（base64），因为这个接口收的是裸二进制流，没有地方放表单字段。
      const startImport = async () => {
        if (!file) return
        setErr(false)
        setMsg('正在传包…')
        try {
          const bytes = new TextEncoder().encode(pwd2 || '')
          let raw = ''
          for (const b of bytes) raw += String.fromCharCode(b)
          const b64 = btoa(raw)

          const res = await fetch(API + '/import?pwd=' + encodeURIComponent(b64), {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: file,
          })
          const r = await res.json()
          if (r && r.ok) {
            setJob(r.job)
            setMsg('传完了，正在解包…')
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

        // ---- 从另一台电脑搬过来 ----
        h('div', { 'data-mv-sep': '' }, '或者，从另一台电脑搬过来'),

        h(
          'div',
          { 'data-mv-card': '' },
          h('div', { 'data-mv-title': '' }, '导入一份搬家包'),
          h(
            'div',
            { 'data-mv-head': '' },
            '选那份 .dshpack，输打包时设的密码。撞上的东西会给原来那份让路，不删任何文件。',
          ),
          h('input', {
            'data-mv-file': '',
            type: 'file',
            accept: '.dshpack',
            disabled: running,
            onChange: (e) => {
              const f = e.target.files && e.target.files[0]
              setFile(f || null)
              setErr(false)
              setMsg('')
            },
          }),
          file
            ? h(
                'div',
                { 'data-mv-grp': '', style: { marginTop: '8px' } },
                h('span', { 'data-mv-grp-name': '' }, file.name),
                h('span', { 'data-mv-grp-s': '' }, mb(file.size)),
              )
            : h('div', { 'data-mv-note': '', style: { marginTop: '8px' } }, '还没选文件'),
          h(
            'div',
            { 'data-mv-field': '', style: { marginTop: '12px' } },
            h('div', { 'data-mv-label': '' }, '密码'),
            h('input', {
              'data-mv-input': '',
              type: 'password',
              value: pwd2,
              disabled: running,
              autoComplete: 'off',
              onChange: (e) => setPwd2(e.target.value),
            }),
          ),
          h(
            'button',
            {
              'data-mv-btn': '',
              style: { marginTop: '12px' },
              disabled: running || !file,
              onClick: startImport,
            },
            running ? '正在处理' : '导入',
          ),
        ),

        // 完成
        done
          ? job.kind === 'import'
            ? h(
                'div',
                { 'data-mv-card': '' },
                h('div', { 'data-mv-title': '' }, '搬完了'),
                h(
                  'div',
                  { 'data-mv-kv': '' },
                  h('b', {}, '新写入'),
                  h('span', {}, String(job.result.totals.written)),
                ),
                h(
                  'div',
                  { 'data-mv-kv': '' },
                  h('b', {}, '覆盖'),
                  h('span', {}, String(job.result.totals.replaced)),
                ),
                h(
                  'div',
                  { 'data-mv-kv': '' },
                  h('b', {}, '没动'),
                  h('span', {}, String(job.result.totals.skipped)),
                ),
                h(
                  'div',
                  { 'data-mv-kv': '' },
                  h('b', {}, '失败'),
                  h('span', {}, String(job.result.totals.failed)),
                ),
                (job.result.report && job.result.report.backedUp && job.result.report.backedUp.length)
                  ? h(
                      'div',
                      { style: { marginTop: '14px' } },
                      h('div', { 'data-mv-title': '' }, '被替换的文件'),
                      ...job.result.report.backedUp.map((b) =>
                        h(
                          'div',
                          { 'data-mv-kv': '' },
                          h('b', {}, b.rel),
                          h('span', {}, '备份为 ' + b.bak),
                        ),
                      ),
                    )
                  : null,
                (job.result.report && job.result.report.workspaces && job.result.report.workspaces.length)
                  ? h(
                      'div',
                      { style: { marginTop: '14px' } },
                      h('div', { 'data-mv-title': '' }, '工作区落在哪'),
                      ...job.result.report.workspaces.map((w) =>
                        h(
                          'div',
                          { 'data-mv-kv': '' },
                          h('b', {}, w.old),
                          h('span', {}, w.now === w.old ? '原样' : w.how + ' → ' + w.now),
                        ),
                      ),
                    )
                  : null,
                job.result.missing && job.result.missing.length
                  ? h(
                      'div',
                      { 'data-mv-confirm': '', style: { marginTop: '12px' } },
                      h('span', {}, '这台机器上还缺这几个插件：' + job.result.missing.join('、')),
                    )
                  : null,
                h('div', { 'data-mv-title': '', style: { marginTop: '14px' } }, '搬家说明'),
                h('div', { 'data-mv-path': '' }, job.result.dir),
                h(
                  'button',
                  {
                    'data-mv-btn': '',
                    style: { marginTop: '10px' },
                    onClick: () => {
                      // 同一个 origin，浏览器直接渲染服务器吐的那份 HTML
                      window.open(API + '/report?id=' + encodeURIComponent(job.id), '_blank')
                    },
                  },
                  '打开搬家说明',
                ),
                h(
                  'button',
                  {
                    'data-mv-btn': '',
                    'data-ghost': '',
                    style: { marginTop: '10px', marginLeft: '8px' },
                    onClick: () => {
                      try {
                        navigator.clipboard.writeText(job.result.dir)
                        setMsg('路径已复制')
                      } catch {
                        setMsg('复制不了，手选一下吧')
                      }
                    },
                  },
                  '复制路径',
                ),
              )
            : h(
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
