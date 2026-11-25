// 扫描清单的临时测试。跑法：
//   node test_plan.mjs
// 只读目录、统计大小，不写盘。

import { buildPlan, human } from './lib/plan.js'

const t0 = Date.now()
const p = await buildPlan()
const ms = Date.now() - t0

console.log('DSH_HOME :', p.home)
console.log('合计     :', p.totals.files, '个文件 /', human(p.totals.bytes), `/ ${ms}ms`)
console.log('')
console.log('分组：')
for (const g of p.groups) {
  console.log(
    '  ' +
      g.label.padEnd(10, '　') +
      String(g.files).padStart(6) +
      ' 个  ' +
      human(g.bytes).padStart(9),
  )
}
if (p.skipped.length) {
  console.log('')
  console.log('跳过：')
  for (const s of p.skipped.slice(0, 20)) {
    console.log('  ' + s.rel + '  —— ' + s.reason)
  }
  if (p.skipped.length > 20) console.log(`  …还有 ${p.skipped.length - 20} 条`)
}
