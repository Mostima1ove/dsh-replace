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
