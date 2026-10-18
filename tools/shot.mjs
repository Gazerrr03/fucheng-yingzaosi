// 开发截图：用本机 Chrome 无头打开页面，按步骤操作后截图。
// node tools/shot.mjs <url> <out.png> [--size 1440x900] [--wait 2500] [--eval "js"] [--click "css"] [--local '{"k":"v"}']
// 可重复多个 --eval / --click，按出现顺序执行；每步之后等 --step 毫秒（默认 600）。

import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error('用法：node tools/shot.mjs <url> <out.png> [选项]');
  process.exit(1);
}
let size = [1440, 900], wait = 2500, step = 600, local = null;
const steps = [];
for (let i = 0; i < rest.length; i += 2) {
  const [k, v] = [rest[i], rest[i + 1]];
  if (k === '--size') size = v.split('x').map(Number);
  else if (k === '--wait') wait = Number(v);
  else if (k === '--step') step = Number(v);
  else if (k === '--local') local = JSON.parse(v);
  else if (['--eval', '--click', '--key', '--drag', '--move'].includes(k)) steps.push([k, v]);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
if (local) {
  await page.addInitScript((kv) => {
    if (sessionStorage.getItem('__shotInit')) return;
    sessionStorage.setItem('__shotInit', '1');
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, local);
}
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);
for (const [k, v] of steps) {
  if (k === '--eval') {
    const r = await page.evaluate(v);
    if (r !== undefined) console.log('eval →', JSON.stringify(r));
  } else if (k === '--click') await page.click(v);
  else if (k === '--key') await page.keyboard.press(v);
  else if (k === '--drag') {
    // "x,y;x,y;…" 按住左键依次经过各点
    const pts = v.split(';').map((p) => p.split(',').map(Number));
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.up();
  } else if (k === '--move') {
    const [x, y] = v.split(',').map(Number);
    await page.mouse.move(x, y);
  }
  await page.waitForTimeout(step);
}
await page.screenshot({ path: out });
await browser.close();
if (logs.length) console.log(logs.join('\n'));
console.log('已保存', out);
