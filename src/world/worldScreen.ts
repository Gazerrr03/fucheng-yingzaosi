// 自定义模式 · 天下舆图：在真实比例的大明疆域上择址建府（参照文明 6「真实地球」地图与开拓者透镜）。
// 悬停看地块，点选看「形胜」评分，「在此建府」后起名、进入城址营建。已建的府城以大印标在图上。

import '../plan/plan.css';
import './world.css';
import { sound } from '../audio/sound';
import type { Hex } from '../scene/hex';
import type { Nav } from '../screens/nav';
import { getFounding, loadFoundings, upsertFounding, type Founding } from './foundings';
import { evaluateSite, gradeOf, terrainLabel, type SiteVerdict } from './siteScore';
import { WorldMap, WORLD_TERRAIN } from './worldMap';
import { WorldView, type Marker } from './worldView';

/** 不在明代府城上建府时的名号候选 */
const NAMES = ['安平', '永宁', '镇远', '怀远', '靖安', '宁康', '崇德', '广顺', '兴隆', '嘉定', '定海', '长乐', '武宁', '思南', '平阳', '清河'];

export const siteIdOf = (h: Hex) => `w${h.q}_${h.r}`.replace(/-/g, 'n');
export function hexOfSiteId(id: string): Hex | null {
  const m = /^w(n?\d+)_(n?\d+)$/.exec(id);
  if (!m) return null;
  const num = (s: string) => (s.startsWith('n') ? -Number(s.slice(1)) : Number(s));
  return { q: num(m[1]), r: num(m[2]) };
}

export async function runWorld(nav: Nav, at: string | null): Promise<void> {
  const map = await WorldMap.load();
  document.body.classList.add('world-mode');
  const canvas = document.createElement('canvas');
  canvas.id = 'world';
  document.body.appendChild(canvas);

  const root = document.createElement('div');
  root.className = 'world-ui';
  root.innerHTML = `
    <header class="w-title">
      <button class="home">← 主界面</button>
      <span class="tag">自定义模式</span>
      <h1>${map.data.name}</h1>
      <p>${map.data.subtitle} · 一格约 ${map.data.hexKm} 公里</p>
    </header>
    <nav class="w-tools">
      <button class="lens" title="快捷键 L">形胜透镜</button>
      <button class="mine" title="快捷键 Tab：在我的府城之间切换">我的府城 <b>0</b></button>
      <button class="zin" title="放大（+）">＋</button>
      <button class="zout" title="缩小（−）">－</button>
    </nav>
    <aside class="w-site" hidden></aside>
    <div class="w-tile" hidden></div>
    <div class="w-mini"><canvas></canvas><span>舆图总览</span></div>
    <div class="w-hint">拖拽平移 · 滚轮缩放 · WASD 移动 · 双击拉近 · L 形胜透镜 · 点选一格择址</div>
    <div class="w-legend">${(['F', 'H', 'S', 'X', 'P', 'C', 'D', 'W'] as const).map((t) => `<span><i style="background:${WORLD_TERRAIN[t].color}"></i>${WORLD_TERRAIN[t].name}</span>`).join('')}
      <span><i class="river"></i>江河</span><span><i class="canal"></i>运河</span><span><i class="border"></i>疆界</span></div>
    <div class="plan-modal w-modal" hidden><div class="sheet"></div></div>
  `;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;

  let foundings = loadFoundings();
  const taken = () => foundings.map((f) => ({ q: f.hex[0], r: f.hex[1] }));

  const view = new WorldView(canvas, map, {
    onHover(h, screen) {
      showTile(h, screen);
    },
    onSelect(h) {
      if (h) sound.tick();
      showSite(h);
    },
    onCamera() {
      drawMini();
    },
  });

  function refreshMarkers() {
    const ms: Marker[] = map.data.cities.map((c) => ({ hex: { q: c.hex[0], r: c.hex[1] }, name: c.name, kind: c.capital ? 'capital' : 'ming' }));
    for (const f of foundings) ms.push({ hex: { q: f.hex[0], r: f.hex[1] }, name: f.name, grade: f.grade, kind: 'mine' });
    view.markers = ms;
    $('.mine b').textContent = String(foundings.length);
    view.invalidate();
  }
  refreshMarkers();

  // ---------------------------------------------------------- 形胜透镜
  let lensCache: Map<string, SiteVerdict> | null = null;
  function lensData(): Map<string, SiteVerdict> {
    if (lensCache) return lensCache;
    const t = taken();
    lensCache = new Map();
    for (const [k, c] of map.cells) {
      if (map.isWater(c)) continue;
      lensCache.set(k, evaluateSite(map, c, { taken: t }));
    }
    return lensCache;
  }
  function setLens(on: boolean) {
    view.lens = on ? lensData() : null;
    $('.lens').classList.toggle('on', on);
    view.invalidate();
  }
  $('.lens').addEventListener('click', () => setLens(!view.lens));

  // ---------------------------------------------------------- 地块信息（悬停）
  const tileEl = $('.w-tile');
  function showTile(h: Hex | null, [x, y]: [number, number]) {
    const c = h && map.cell(h);
    if (!c) {
      tileEl.hidden = true;
      return;
    }
    const city = map.cityAt.get(`${c.q},${c.r}`);
    const mine = foundings.find((f) => f.hex[0] === c.q && f.hex[1] === c.r);
    const s = !map.isWater(c) ? evaluateSite(map, c, { taken: taken() }) : null;
    tileEl.innerHTML = `
      <b>${mine ? `${mine.name}（我的府城）` : city ? city.name : terrainLabel(c)}</b>
      <span>${[mine || city ? terrainLabel(c) : '', c.prov ?? (c.domain ? '' : '塞外'), c.elev > 50 ? `海拔约 ${c.elev} 米` : ''].filter(Boolean).join(' · ')}</span>
      ${c.riverNames.length ? `<span class="water">${c.riverNames.join('、')}</span>` : ''}
      ${s ? (s.ok ? `<em class="score g${gradeIdx(s.grade)}">形胜 ${s.total} · ${s.grade}</em>` : `<em class="bad">${s.reason}</em>`) : ''}`;
    tileEl.hidden = false;
    const w = tileEl.offsetWidth, hgt = tileEl.offsetHeight;
    tileEl.style.transform = `translate(${Math.min(x + 18, innerWidth - w - 12)}px, ${Math.min(y + 18, innerHeight - hgt - 12)}px)`;
  }

  // ---------------------------------------------------------- 择址面板（点选）
  const siteEl = $('.w-site');
  function showSite(h: Hex | null) {
    const c = h && map.cell(h);
    if (!c) {
      siteEl.hidden = true;
      return;
    }
    const city = map.cityAt.get(`${c.q},${c.r}`);
    const mine = foundings.find((f) => f.hex[0] === c.q && f.hex[1] === c.r);
    const s = evaluateSite(map, c, { taken: taken() });
    const title = mine ? mine.name : city ? city.name : terrainLabel(c);
    let body = '';
    if (map.isWater(c)) {
      body = `<p class="muted">${WORLD_TERRAIN[c.t].name}。${c.t === 'W' ? '湖泽之中不能筑城，可在湖滨择址。' : ''}</p>`;
    } else {
      body = `
        <div class="w-score ${s.ok ? `g${gradeIdx(s.grade)}` : 'bad'}">
          <b>${s.ok ? s.total : '—'}</b><span>${s.ok ? `形胜 · ${s.grade}` : s.reason}</span>
        </div>
        ${s.ok ? `<ul class="w-factors">${s.factors.map((f) => `
          <li class="${f.score < 0 ? 'neg' : ''}"><i>${f.name}</i>
            ${f.max ? `<span class="bar"><span style="width:${Math.max(0, (f.score / f.max) * 100)}%"></span></span><em>${f.score}/${f.max}</em>` : `<em>${f.score}</em>`}
            <small>${f.text}</small></li>`).join('')}</ul>` : ''}
        ${city?.known ? `<p class="known">此地有实测城图，建府后在${city.name.replace(/府$/, '')}真实山水上营建。</p>` : city ? `<p class="known">明代${city.name}治所。可在旧治上重新规划。</p>` : ''}`;
    }
    const canFound = s.ok && !mine;
    siteEl.innerHTML = `
      <span class="kicker">${c.prov ?? (c.domain ? '' : '塞外')}${c.riverNames.length ? ` · ${c.riverNames.join('、')}` : ''}</span>
      <h2>${title}</h2>
      <p class="muted">${terrainLabel(c)}${c.elev > 50 ? ` · 海拔约 ${c.elev} 米` : ''}</p>
      ${body}
      <div class="actions">
        ${mine ? `<button class="primary" data-act="enter">入城营建</button>` : ''}
        ${canFound ? `<button class="primary" data-act="found">在此建府</button>` : ''}
        <button data-act="close">关闭</button>
      </div>`;
    siteEl.hidden = false;
    siteEl.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'close') {
          view.selected = null;
          siteEl.hidden = true;
          view.invalidate();
        } else if (act === 'enter') {
          sound.click();
          void nav.go(`?custom=${mine!.id}`);
        } else if (act === 'found') {
          sound.click();
          void found(c, s, city);
        }
      }),
    );
  }

  async function found(h: Hex, s: SiteVerdict, city?: WorldMap['data']['cities'][number]) {
    const id = city?.known ?? siteIdOf(h);
    if (getFounding(id)) {
      void nav.go(`?custom=${id}`);
      return;
    }
    const used = new Set(foundings.map((f) => f.name));
    const suggest = city ? city.name : `${NAMES.find((n) => !used.has(`${n}府`)) ?? '新'}府`;
    const html = `<span class="kicker">建府 · 形胜 ${s.total}（${s.grade}）</span>
      <h2>为新府命名</h2>
      <p>${s.factors.filter((f) => f.score > 0 && f.max).sort((a, b) => b.score / b.max - a.score / a.max).slice(0, 2).map((f) => f.text).join('；')}。</p>
      <input class="w-name" maxlength="6" value="${suggest}">
      <p class="muted">建府之后进入城址：按山水走势筑城墙、开城门、置府署坛庙。随时可回舆图另择他处。</p>`;
    const choice = await modal(html, '建府入城', '再看看');
    if (choice !== 0) return;
    const name = (root.querySelector<HTMLInputElement>('.w-name')?.value.trim() || suggest).replace(/[<>&"]/g, '');
    const f: Founding = { id, name, hex: [h.q, h.r], site: s.total, created: Date.now() };
    upsertFounding(f);
    foundings = loadFoundings();
    lensCache = null;
    refreshMarkers();
    void nav.go(`?custom=${id}`);
  }

  function modal(html: string, ...buttons: string[]): Promise<number> {
    const m = $('.w-modal');
    const sheet = m.querySelector<HTMLElement>('.sheet')!;
    sheet.innerHTML = `${html}<div class="actions">${buttons.map((b, i) => `<button data-i="${i}" class="${i ? '' : 'primary'}">${b}</button>`).join('')}</div>`;
    m.hidden = false;
    sheet.querySelector<HTMLInputElement>('input')?.select();
    return new Promise((resolve) => {
      const done = (i: number) => {
        m.hidden = true;
        resolve(i);
      };
      sheet.querySelectorAll<HTMLButtonElement>('.actions button').forEach((b) => b.addEventListener('click', () => done(Number(b.dataset.i))));
      sheet.querySelector('input')?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') done(0);
      });
    });
  }

  // ---------------------------------------------------------- 迷你地图
  const mini = root.querySelector<HTMLCanvasElement>('.w-mini canvas')!;
  const mctx = mini.getContext('2d')!;
  function drawMini() {
    const src = view.overviewCanvas();
    const W = 220, H = Math.round((W * src.height) / src.width);
    if (mini.width !== W * 2) {
      mini.width = W * 2;
      mini.height = H * 2;
      mini.style.width = `${W}px`;
      mini.style.height = `${H}px`;
    }
    mctx.setTransform(2, 0, 0, 2, 0, 0);
    mctx.drawImage(src, 0, 0, W, H);
    const k = W / src.width;
    const v = view.viewRect();
    const [x0, y0] = view.worldToCache(v.x0, v.y1);
    const [x1, y1] = view.worldToCache(v.x1, v.y0);
    mctx.strokeStyle = '#b8322a';
    mctx.lineWidth = 1.5;
    mctx.strokeRect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
    for (const f of foundings) {
      const [x, y] = view.worldToCache(...map.world({ q: f.hex[0], r: f.hex[1] }));
      mctx.fillStyle = '#b8322a';
      mctx.fillRect(x * k - 2.5, y * k - 2.5, 5, 5);
    }
  }
  let miniDrag = false;
  const miniJump = (e: PointerEvent) => {
    const r = mini.getBoundingClientRect();
    const src = view.overviewCanvas();
    const k = src.width / r.width;
    const [x, y] = view.cacheToWorld((e.clientX - r.left) * k, (e.clientY - r.top) * k);
    view.camX = x;
    view.camY = y;
    view.invalidate();
    drawMini();
  };
  mini.addEventListener('pointerdown', (e) => {
    miniDrag = true;
    mini.setPointerCapture(e.pointerId);
    miniJump(e);
  });
  mini.addEventListener('pointermove', (e) => miniDrag && miniJump(e));
  mini.addEventListener('pointerup', () => (miniDrag = false));

  // ---------------------------------------------------------- 工具条
  let mineIdx = -1;
  function nextMine() {
    if (!foundings.length) {
      toastHint('还没有建府。点选一格，再点「在此建府」。');
      return;
    }
    mineIdx = (mineIdx + 1) % foundings.length;
    const f = foundings[mineIdx];
    const h = { q: f.hex[0], r: f.hex[1] };
    view.selected = h;
    view.flyTo(h, 80);
    showSite(h);
  }
  $('.mine').addEventListener('click', nextMine);
  $('.zin').addEventListener('click', () => view.zoomBy(1.6));
  $('.zout').addEventListener('click', () => view.zoomBy(1 / 1.6));
  $('.home').addEventListener('click', () => void nav.home());
  const hintEl = $('.w-hint');
  function toastHint(text: string) {
    hintEl.textContent = text;
    hintEl.classList.add('flash');
    setTimeout(() => hintEl.classList.remove('flash'), 1600);
  }
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === 'l' || e.key === 'L') setLens(!view.lens);
    if (e.key === 'Tab') {
      e.preventDefault();
      nextMine();
    }
    if (e.key === 'Escape') {
      view.selected = null;
      siteEl.hidden = true;
      view.invalidate();
    }
  });

  // 初始镜头：从城里回来时对准那座城，否则看全图
  const focus = at?.split(',').map(Number);
  if (focus && focus.length === 2 && map.cell({ q: focus[0], r: focus[1] })) {
    const h = { q: focus[0], r: focus[1] };
    view.jumpTo(h, 70);
    view.selected = h;
    showSite(h);
  }
  drawMini();
  Object.assign(window, { __world: map, __worldView: view, __evaluateSite: evaluateSite });
  document.body.classList.add('ready');
  await nav.arrive();
}

function gradeIdx(g: string): number {
  return ['下', '中', '上', '上上'].indexOf(g);
}

export { gradeOf };
