// 搬家 · 导出说明
//
// 生成两份：一份 HTML（好看、双击就开、手机上也能看），一份 txt 兜底。
//
// 写给谁看：半年后忘了这回事的你。所以每句话都要能独立成立，
// 不出现「参照上文」，也不写「你刚才设的密码是……」这种靠上下文才成立的话。

import fs from 'node:fs/promises'
import path from 'node:path'
import { human } from './plan.js'

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function fmtTime(iso) {
  try {
    const d = new Date(iso)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch {
    return iso
  }
}

function buildHtml({ manifest, packFile, packBytes, groups }) {
  const when = fmtTime(manifest.createdAt)
  const host = manifest.host || {}
  const rows = groups
    .map(
      (g) =>
        `<tr><td>${esc(g.label)}</td><td class="n">${g.files}</td><td class="n">${esc(human(g.bytes))}</td></tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 搬家包 · ${esc(when)}</title>
<style>
  :root{
    --ink:#111;
    --dim:#7a7a76;
    --line:#dedcd6;
    --blue:#1B3EE8;
    --bg:#FAFAF8;
  }
  *{box-sizing:border-box;}
  body{
    margin:0;
    background:var(--bg);
    color:var(--ink);
    font-family:"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;
    font-size:15px;
    line-height:1.85;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:720px;margin:0 auto;padding:72px 28px 120px;}
  .bar{width:100%;height:8px;background:var(--blue);}
  .kicker{
    font:11px/1.6 ui-monospace,Consolas,"Courier New",monospace;
    letter-spacing:.34em;
    text-transform:uppercase;
    color:var(--dim);
  }
  h1{
    font-size:44px;
    line-height:1.08;
    letter-spacing:-.02em;
    margin:14px 0 8px;
    font-weight:800;
  }
  h1 em{font-style:normal;color:var(--blue);}
  .sub{color:var(--dim);font-size:13.5px;margin-bottom:40px;}
  h2{
    font-size:12px;
    letter-spacing:.22em;
    text-transform:uppercase;
    color:var(--dim);
    font-weight:600;
    margin:48px 0 14px;
    padding-top:18px;
    border-top:1px solid var(--line);
  }
  p{margin:0 0 12px;}
  table{width:100%;border-collapse:collapse;font-size:14px;}
  th,td{text-align:left;padding:8px 0;border-bottom:1px solid var(--line);}
  th{font-weight:600;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);}
  td.n{text-align:right;font-family:ui-monospace,Consolas,monospace;font-size:13px;width:96px;}
  .total td{border-bottom:none;font-weight:700;padding-top:12px;}
  ol{margin:0;padding-left:0;list-style:none;counter-reset:s;}
  ol li{
    counter-increment:s;
    position:relative;
    padding-left:42px;
    margin-bottom:16px;
  }
  ol li::before{
    content:counter(s,decimal-leading-zero);
    position:absolute;
    left:0;
    top:0;
    font:11px/1.9 ui-monospace,Consolas,monospace;
    letter-spacing:.08em;
    color:var(--blue);
  }
  .note{
    margin-top:14px;
    padding:16px 18px;
    border-left:2px solid var(--blue);
    background:#fff;
    font-size:13.5px;
  }
  .note b{display:block;margin-bottom:6px;}
  code{
    font-family:ui-monospace,Consolas,monospace;
    font-size:12.5px;
    background:#f0efeb;
    padding:2px 6px;
    border-radius:4px;
    word-break:break-all;
  }
  .foot{
    margin-top:64px;
    padding-top:18px;
    border-top:1px solid var(--line);
    font:11px/1.9 ui-monospace,Consolas,monospace;
    color:var(--dim);
    letter-spacing:.06em;
  }
  .foot span{display:block;}
</style>
</head>
<body>
<div class="bar"></div>
<div class="wrap">

  <div class="kicker">DSH · 搬家包</div>
  <h1>这台电脑上的<br><em>所有痕迹</em></h1>
  <div class="sub">${esc(when)} · 来自 ${esc(host.machine || '未知机器')} · ${esc(host.user || '')}</div>

  <p>这是一份搬家包。里面装着这台电脑上 DSH 的会话、插件配置、技能和人设。把它拷到另一台电脑，在那边装好的 DSH 里点两下，就能接着用。</p>

  <h2>包里有什么</h2>
  <table>
    <thead><tr><th>类别</th><th class="n">文件</th><th class="n">大小</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="total"><td>合计</td><td class="n">${manifest.entries}</td><td class="n">${esc(human(packBytes))}</td></tr>
    </tbody>
  </table>
  <p style="margin-top:14px;font-size:13px;color:#7a7a76;">包大小和上面合计对不上是正常的：文本压得动，图片压不动。</p>

  <h2>怎么用</h2>
  <ol>
    <li><b>拷过去。</b>把这个文件夹整个拷到另一台电脑。U 盘、移动硬盘都行，别用聊天软件传——它们会改大小写、偶尔还会删东西。</li>
    <li><b>在那边打开 DSH。</b>确认「设置 → 搬家」这一页在。不在的话，先把搬家插件装上（和这台电脑上装的是同一个）。</li>
    <li><b>点「导入」，选这个文件夹里的 <code>搬家包.dshpack</code>。</b>然后输密码。</li>
    <li><b>等它跑完。</b>跑完会生成一份搬家说明，写清楚装了什么、覆盖了什么、备份在哪。</li>
  </ol>

  <div class="note">
    <b>密码是你打包时自己设的那个。</b>
    忘了就只能回这台电脑重新打一份。这份包里没有留后门，也没有找回的办法——这是设计如此，不是缺陷。
  </div>

  <h2>三个别做的</h2>
  <p><b>别传网盘。</b>包里有会话记录，那些是你的原话，不是公开内容。</p>
  <p><b>别把包留着不拷。</b>这台电脑是要还回去或者重装的，包是唯一的副本。</p>
  <p><b>别只拷 <code>.dshpack</code> 一个文件就删掉别的。</b>同目录的 <code>清单.json</code> 记录了包里有什么，出问题时靠它核对。</p>

  <div class="foot">
    <span>格式 dsh-move / v${esc(manifest.version)}</span>
    <span>打包时间 ${esc(fmtTime(manifest.createdAt))}</span>
    <span>源机器 ${esc(host.machine || '')} · ${esc(host.platform || '')}</span>
    <span>源 DSH 目录 ${esc(host.dshHome || '')}</span>
    <span>加密 ${manifest.encrypted ? 'AES-256-GCM / PBKDF2-SHA256 ' + ((manifest.kdf && manifest.kdf.iterations) || '') + ' 次' : '未加密'}</span>
  </div>

</div>
</body>
</html>
`
}

function buildTxt({ manifest, packBytes, groups }) {
  const lines = []
  lines.push('DSH 搬家包')
  lines.push('='.repeat(40))
  lines.push(`打包时间：${fmtTime(manifest.createdAt)}`)
  lines.push(`源机器：${(manifest.host && manifest.host.machine) || ''}`)
  lines.push(`源 DSH 目录：${(manifest.host && manifest.host.dshHome) || ''}`)
  lines.push('')
  lines.push('包里有什么')
  lines.push('-'.repeat(40))
  for (const g of groups) {
    lines.push(`  ${g.label}：${g.files} 个文件，${human(g.bytes)}`)
  }
  lines.push(`  合计：${manifest.entries} 个文件，${human(packBytes)}`)
  lines.push('')
  lines.push('怎么用')
  lines.push('-'.repeat(40))
  lines.push('  1. 把整个文件夹拷到另一台电脑')
  lines.push('  2. 在那边打开 DSH，进「设置 → 搬家」')
  lines.push('  3. 点「导入」，选 搬家包.dshpack，输密码')
  lines.push('  4. 等它跑完，会生成一份搬家说明')
  lines.push('')
  lines.push('密码是你打包时自己设的那个。忘了只能重新打包，包里没有后门。')
  lines.push('')
  lines.push('别传网盘，别把包留着不拷。')
  lines.push('')
  lines.push(`加密：${manifest.encrypted ? 'AES-256-GCM' : '未加密'}`)
  lines.push('')
  return lines.join('\r\n')
}

/**
 * 把说明写进包目录。
 * @returns {Promise<{html:string, txt:string}>}
 */
export async function writeReadme({ dir, manifest, packFile, packBytes, groups }) {
  const htmlPath = path.join(dir, '搬家说明.html')
  const txtPath = path.join(dir, '搬家说明.txt')
  await fs.writeFile(htmlPath, buildHtml({ manifest, packFile, packBytes, groups }), 'utf8')
  await fs.writeFile(txtPath, buildTxt({ manifest, packBytes, groups }), 'utf8')
  return { html: htmlPath, txt: txtPath }
}

/* ------------------------------------------------------------------ */
/* 导入说明：写给「刚搬完、有点不确定自己干了什么」的那个人             */
/* ------------------------------------------------------------------ */

const CSS2 = `
:root{--ink:#14151a;--dim:#6b6d78;--line:#e4e2dd;--bg:#faf9f6;--blue:#1b3ee8;--warn:#b4651c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.85 "Source Han Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.top{height:8px;background:var(--blue)}
main{max-width:820px;margin:0 auto;padding:64px 28px 96px}
.kicker{font:11px/1 ui-monospace,Consolas,monospace;letter-spacing:.28em;color:var(--dim);text-transform:uppercase}
h1{margin:14px 0 6px;font-size:40px;line-height:1.15;font-weight:800;letter-spacing:-.02em}
h1 em{font-style:normal;color:var(--blue)}
.sub{color:var(--dim);font-size:13px;margin-bottom:40px}
.lede{font-size:16px;line-height:1.9;margin:0 0 40px}
h2{margin:48px 0 14px;font-size:12px;letter-spacing:.18em;color:var(--dim);text-transform:uppercase;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:11px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font:11px/1 ui-monospace,Consolas,monospace;letter-spacing:.14em;color:var(--dim);font-weight:400}
td.n{text-align:right;font:13px/1.6 ui-monospace,Consolas,monospace;color:var(--dim);white-space:nowrap}
code{font:12px/1.6 ui-monospace,Consolas,monospace;background:#f0eee9;padding:1px 5px;border-radius:3px;word-break:break-all}
ul{padding-left:20px;margin:10px 0}
li{margin:7px 0}
.note{border-left:3px solid var(--blue);padding:12px 0 12px 16px;margin:26px 0;color:#333;font-size:14px}
.warn{border-left:3px solid var(--warn);padding:12px 0 12px 16px;margin:26px 0;font-size:14px}
.big{display:flex;gap:38px;flex-wrap:wrap;margin:34px 0 8px}
.big div{min-width:88px}
.big b{display:block;font-size:30px;font-weight:800;line-height:1.1}
.big span{font:11px/1 ui-monospace,Consolas,monospace;letter-spacing:.14em;color:var(--dim)}
.foot{margin-top:64px;padding-top:20px;border-top:1px solid var(--line);
  font:11px/2 ui-monospace,Consolas,monospace;color:var(--dim)}
`

function buildImportHtml({ result, localHome, when }) {
  const { manifest, report, totals } = result
  const host = result.host || {}
  const bakRows = report.backedUp
    .slice(0, 400)
    .map((b) => `<tr><td><code>${esc(b.rel)}</code></td><td><code>${esc(b.bak)}</code></td></tr>`)
    .join('')
  const skipRows = report.skipped
    .slice(0, 200)
    .map((s) => `<tr><td><code>${esc(s.rel)}</code></td><td>${esc(s.why)}</td></tr>`)
    .join('')
  const miss = result.missing || []
  const merged = report.merged

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>搬家结果 · ${esc(when)}</title>
<style>${CSS2}</style>
</head>
<body>
<div class="top"></div>
<main>
  <div class="kicker">DSH · 搬家</div>
  <h1>搬完了。<em>这些被改动过</em></h1>
  <div class="sub">${esc(when)} · 来自 ${esc(host.machine || '另一台电脑')} 的包</div>

  <p class="lede">
    这个包是 ${esc(fmtTime(manifest.createdAt))} 在 ${esc(host.machine || '旧电脑')} 上打的。
    下面每一个数字都是这台机器上真实发生的事：多少文件新写进来、多少把原来的顶掉了、
    顶掉的那些退到了哪里。想退回去，看最后一节。
  </p>

  <div class="big">
    <div><b>${totals.written}</b><span>新写入</span></div>
    <div><b>${totals.replaced}</b><span>覆盖</span></div>
    <div><b>${totals.skipped}</b><span>没动</span></div>
    <div><b>${totals.failed}</b><span>失败</span></div>
  </div>

  ${
    miss.length
      ? `<div class="warn">
    <b>这几个插件，包里只有数据，没有插件本体。</b><br>
    插件代码不进包（几百兆，而且多半和你这台机器的 DSH 版本对不上），所以它们的数<em>据</em>搬过来了，
    插件本身还得你自己装：<br>
    ${miss.map((m) => `<code>${esc(m)}</code>`).join(' ')}
  </div>`
      : ''
  }

  ${
    merged && (merged.bundles.length || merged.deps.length)
      ? `<h2>插件清单</h2>
  <p>本机的 <code>profiles/desktop/package.json</code> 没有被整体覆盖（那样会把你在这台机器上装的插件全冲掉），
  只把包里多出来的名字加了进去：</p>
  <ul>
    ${merged.bundles.map((b) => `<li>bundle：<code>${esc(b)}</code></li>`).join('')}
    ${merged.deps.map((d) => `<li>依赖：<code>${esc(d)}</code></li>`).join('')}
  </ul>`
      : ''
  }

  ${
    (report.workspaces || []).length
      ? `<h2>工作区落在哪</h2>
  <p>会话是按工作区归类的。旧电脑上的路径在这台机器上不一定成立，所以每一条都单独判过：</p>
  <table><tr><th>旧电脑上</th><th>这台机器上</th><th>怎么处理的</th></tr>
  ${report.workspaces
    .map(
      (w) =>
        `<tr><td><code>${esc(w.old)}</code></td><td><code>${esc(w.now)}</code></td><td>${esc(
          w.how + (w.sessions ? `，改了 ${w.sessions} 个会话` : ''),
        )}</td></tr>`,
    )
    .join('')}</table>
  <p class="sub">换位置的时候只动了每个会话文件的第一帧（元数据里的 cwd），后面几千帧原样保留。</p>`
      : ''
  }

  <h2>被顶掉的文件</h2>
  ${
    report.backedUp.length
      ? `<p>${report.backedUp.length} 个。原来那份没有删，只是改了名字，还躺在同一个目录里。</p>
  <table><tr><th>原路径</th><th>备份成了</th></tr>${bakRows}</table>
  ${report.backedUp.length > 400 ? `<p class="sub">只列了前 400 条，全部记录在同目录的 清单.json 里。</p>` : ''}`
      : `<p>没有文件被顶掉。</p>`
  }

  <h2>没动的</h2>
  ${
    report.skipped.length
      ? `<table><tr><th>路径</th><th>为什么</th></tr>${skipRows}</table>`
      : `<p>没有。</p>`
  }

  ${
    report.errors.length
      ? `<h2>失败的</h2>
  <table><tr><th>路径</th><th>错误</th></tr>${report.errors
    .slice(0, 60)
    .map((e) => `<tr><td><code>${esc(e.rel)}</code></td><td>${esc(e.error)}</td></tr>`)
    .join('')}</table>`
      : ''
  }

  <h2>出事了怎么退回去</h2>
  <p>所有被顶掉的原文件都在原目录，名字后面多了 <code>.bak-${esc(report.tag)}</code>。
  想退回某一个，把 <code>.bak-${esc(report.tag)}</code> 去掉、覆盖回去就行。</p>
  <p>想全部退回：把上面「被顶掉的文件」那两列对着来，一列一列改回原名。</p>

  <div class="note">
    这次导入只碰了 <code>${esc(localHome)}</code> 里的东西。
    这台机器上原本就有的会话、附件、插件，没有被删任何一个。
  </div>

  <div class="foot">
    格式 dsh-move / v${esc(manifest.version)}<br>
    包来自 ${esc(host.machine || '')} · ${esc(host.platform || '')}<br>
    导入时间 ${esc(when)} · 目标目录 ${esc(localHome)}<br>
    备份后缀 .bak-${esc(report.tag)}
  </div>
</main>
</body>
</html>
`
}

/**
 * 写导入说明。
 *
 * @param {object} o
 * @param {string} o.dir     写到哪里（一般是一个新目录）
 * @param {object} o.result  importPack() 的返回值
 * @param {string} o.localHome
 * @returns {Promise<{html:string, txt:string, when:string}>}
 */
export async function writeImportReport({ dir, result, localHome }) {
  const when = fmtTime(new Date().toISOString())
  const htmlPath = path.join(dir, '搬家说明-导入.html')
  const txtPath = path.join(dir, '搬家说明-导入.txt')

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(htmlPath, buildImportHtml({ result, localHome, when }), 'utf8')

  const t = result.totals
  const lines = [
    'DSH 搬家 · 导入结果',
    '='.repeat(40),
    `导入时间：${when}`,
    `包来自：${(result.host && result.host.machine) || ''}`,
    `打到这个包：${fmtTime(result.manifest.createdAt)}`,
    `写进了：${localHome}`,
    '',
    '这次动了什么',
    '-'.repeat(40),
    `  新写入：${t.written}`,
    `  覆盖：${t.replaced}`,
    `  没动：${t.skipped}`,
    `  失败：${t.failed}`,
    '',
  ]
  if (result.missing && result.missing.length) {
    lines.push('包里只有数据、没有插件本体的：')
    for (const m of result.missing) lines.push(`  ${m}`)
    lines.push('')
  }
  if (result.report.backedUp.length) {
    lines.push('被顶掉的文件（原来那份改成了 .bak-后缀）')
    lines.push('-'.repeat(40))
    for (const b of result.report.backedUp.slice(0, 200)) lines.push(`  ${b.rel}  →  ${b.bak}`)
    lines.push('')
  }
  lines.push(`想退回：把带 .bak-${result.report.tag} 的文件改回原名，覆盖回去。`)
  lines.push('')
  await fs.writeFile(txtPath, lines.join('\r\n'), 'utf8')

  return { html: htmlPath, txt: txtPath, when }
}
