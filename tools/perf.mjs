// 性能与兼容性巡检：用本机 Google Chrome 和 Playwright WebKit（Safari 内核）跑三座城。
// 前提：npm run dev 已在 5173 端口运行。
// 用法：node tools/perf.mjs [chrome|webkit ...]

import { chromium, webkit } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CASES = [
  { city: 'xiangyang', site: 'zhaoming' },
  { city: 'jingzhou', site: 'binyang' },
  { city: 'baoding', site: 'fushu' },
];

const engines = {
  chrome: () => chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu'] }),
  webkit: () => webkit.launch({ headless: true }),
};

/** 在页面里连续采样 n 帧，返回帧间隔统计（毫秒）。 */
const sampleFrames = (n) => new Promise((resolve) => {
  const ts = [];
  const step = (t) => {
    ts.push(t);
    if (ts.length > n) {
      const d = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b);
      resolve({ avg: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2), max: +d[d.length - 1].toFixed(2) });
    } else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});

async function run(name) {
  const browser = await engines[name]();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const out = { engine: name, version: browser.version(), cities: [] };

  for (const { city, site } of CASES) {
    const t0 = Date.now();
    await page.goto(`${BASE}/?city=${city}`);
    await page.waitForFunction(() => document.body.classList.contains('ready') && window.__level, null, { timeout: 30000 });
    const load = Date.now() - t0;
    process.stderr.write(`[${name}] ${city} 加载完成\n`);
    if (!out.gpu) {
      out.gpu = await page.evaluate(() => {
        const gl = document.querySelector('#map').getContext('webgl2');
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      });
    }
    // 地图：边平移边采样
    const map = await page.evaluate(async (sample) => {
      const v = window.__view;
      let k = 0;
      const id = setInterval(() => v.camera.panBy(Math.sin(k++ / 5) * 30, 6), 16);
      const r = await (0, eval)(`(${sample})`)(180);
      clearInterval(id);
      return r;
    }, sampleFrames.toString());
    process.stderr.write(`[${name}] ${city} 地图采样完成\n`);
    // 地块：进入并等云散开
    const t1 = Date.now();
    await page.evaluate((s) => window.__enter(s), site);
    await page.waitForFunction(() => window.__tile?.active && document.querySelector('.clouds')?.hidden, null, { timeout: 30000 });
    const enter = Date.now() - t1;
    process.stderr.write(`[${name}] ${city} 已进入地块\n`);
    const tile = await page.evaluate(async (sample) => (0, eval)(`(${sample})`)(180), sampleFrames.toString());
    const models = await page.evaluate(() => window.__tile.modelReport.reduce((a, m) => ((a[m.source] = (a[m.source] ?? 0) + 1), a), {}));
    const tris = await page.evaluate(() => window.__tile.modelReport.reduce((a, m) => a + (m.triangles ?? 0), 0));
    out.cities.push({ city, load, enter, map, tile, models, tris });
  }
  out.errors = errors;
  // 本机 Chrome 的 headless 模式偶尔卡在关闭上，限时 5 秒
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  return out;
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(engines);
for (const name of wanted) {
  try {
    const r = await run(name);
    console.log(`\n== ${r.engine} ${r.version} · GPU: ${r.gpu}`);
    for (const c of r.cities) {
      console.log(`  ${c.city.padEnd(10)} 加载 ${c.load} ms · 进入地块 ${c.enter} ms · 地图帧 ${c.map.avg}/${c.map.p95}/${c.map.max} ms · 地块帧 ${c.tile.avg}/${c.tile.p95}/${c.tile.max} ms · ${c.tris} 面 · ${JSON.stringify(c.models)}`);
    }
    console.log(r.errors.length ? `  控制台错误：\n    ${r.errors.join('\n    ')}` : '  控制台错误：无');
  } catch (err) {
    console.log(`\n== ${name} 失败：${err.message}`);
  }
}
process.exit(0);
