// 经典模式舆图：图上四座府城就是四节营建课，按 保定 → 襄阳 → 荆州 → 武昌 顺次解锁。
// 点开一座城：营建课（主）＋ 城中寻访（有寻访关卡的城才有）。三城寻访全部通关后开放三城对比。

import { assetUrl, fetchLevel } from '../game/assets';
import { CITIES, GENE_COUNT, cityLitGenes } from '../game/cities';
import { Progress, loadReputation } from '../game/progress';
import type { Nav } from './nav';
import { sound } from '../audio/sound';
import { LESSONS, lessonProgress, type Lesson } from '../plan/lessons';

const MAP_W = 1536, MAP_H = 1024;

/** 四城在舆图上的位置（像素）。武昌在荆州下游、大江南岸。 */
const POS: Record<string, [number, number]> = {
  baoding: [812, 158],
  xiangyang: [445, 572],
  jingzhou: [802, 712],
  wuchang: [1176, 792],
};
/** 标签放在印的左边（靠右的城，免得出画） */
const LABEL_LEFT = new Set(['wuchang']);

const SEEN_KEY = 'sanfu.classic.unlockSeen';

function seenUnlocks(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function lessonUnlocked(i: number): boolean {
  if (i <= 0) return true;
  return !!lessonProgress()[LESSONS[i - 1].id]?.done;
}

export async function runOverview(nav: Nav): Promise<void> {
  const progress = new Progress();
  const levels = await Promise.all(CITIES.map((c) => fetchLevel(c.id)));
  const lit = new Map(levels.map((d) => [d.id, cityLitGenes(d, progress).length]));
  const exploreDone = [...lit.values()].filter((n) => n === GENE_COUNT).length;
  const records = lessonProgress();
  const reputation = loadReputation();
  const unlocked = LESSONS.map((_, i) => lessonUnlocked(i));
  const passed = LESSONS.filter((l) => records[l.id]?.done).length;
  const seen = seenUnlocks();
  // 新解锁、还没播过解锁动画的城
  const fresh = LESSONS.filter((l, i) => i > 0 && unlocked[i] && !seen.includes(l.id)).map((l) => l.id);

  const root = document.createElement('div');
  root.className = 'overview classic';
  root.innerHTML = `
    <div class="ov-map" style="aspect-ratio: ${MAP_W} / ${MAP_H}">
      <img src="${assetUrl('maps/overview')}" alt="">
      ${LESSONS.map((l, i) => {
        const [x, y] = POS[l.id];
        const rec = records[l.id];
        const state = rec?.done ? 'done' : unlocked[i] ? 'open' : 'locked';
        const sealCity = CITIES.some((c) => c.id === l.id) ? l.id : 'baoding';
        return `
        <button class="ov-city ${state} ${LABEL_LEFT.has(l.id) ? 'left' : ''} ${fresh.includes(l.id) ? 'fresh' : ''}" data-i="${i}"
          style="left: ${(x / MAP_W) * 100}%; top: ${(y / MAP_H) * 100}%">
          <span class="ov-seal"><img src="${assetUrl(`ui/seal_${sealCity}`)}" alt=""><b>${l.cityName.slice(0, 2).split('').join('<br>')}</b>
            <i class="ov-ord">${l.ordinal}</i></span>
          <span class="ov-label">
            <strong>${l.cityName}</strong>
            <em>${state === 'locked' ? `过第${LESSONS[i - 1].ordinal}课「${LESSONS[i - 1].cityName}」后解锁` : l.title}</em>
            <span class="ov-progress">${state === 'done' ? `已过关 · ${rec!.grade ?? ''}` : state === 'open' ? '可营建' : '未解锁'}</span>
          </span>
        </button>`;
      }).join('')}
    </div>
    <header class="ov-top">
      <button class="ov-back">← 主界面</button>
      <span class="tag">经典模式</span>
    </header>
    <aside class="ov-intro">
      <h1>经典模式 · 营建课</h1>
      <p>四座府城，四种规划思路：平原 → 临水 → 绕水 → 含山。过一课，解锁下一城。</p>
      <ol class="ov-steps">${LESSONS.map((l, i) => `<li class="${records[l.id]?.done ? 'done' : unlocked[i] ? 'open' : ''}"><i>${l.ordinal}</i>${l.cityName}</li>`).join('')}</ol>
      <p class="ov-hint">已过 ${passed} / ${LESSONS.length} 课 · 点图上的府城开始。</p>
      ${reputation.length ? `<p class="ov-rep"><b>声望</b>${reputation.map((r) => `<span title="${r.source}">${r.name}</span>`).join('')}</p>` : ''}
      <button class="ov-compare" ${exploreDone === CITIES.length ? '' : 'disabled'}>
        三城对比${exploreDone === CITIES.length ? '' : `<small>保定、襄阳、荆州三城寻访全部通关后开启（${exploreDone} / ${CITIES.length}）</small>`}
      </button>
    </aside>
    <div class="ov-card" hidden><div class="sheet"></div></div>
  `;
  document.body.appendChild(root);
  sound.ambient(['wind']);

  const card = root.querySelector<HTMLElement>('.ov-card')!;
  const openCard = (l: Lesson) => {
    const rec = records[l.id];
    const explore = CITIES.find((c) => c.id === l.id);
    const genes = lit.get(l.id) ?? 0;
    card.querySelector('.sheet')!.innerHTML = `
      <span class="kicker">经典模式 · 第${l.ordinal}课</span>
      <h2>${l.cityName} · ${l.title}</h2>
      <p>${l.blurb}</p>
      <p class="intro">${l.intro[0]}</p>
      <p class="status">${rec?.done ? `已过关 · 风水总评 ${rec.grade ?? ''}（${rec.total ?? ''}）` : '尚未过关'}</p>
      <div class="actions">
        <button class="primary" data-act="lesson">${rec?.done ? '再营此城' : '开始营建课'}</button>
        ${explore ? `<button data-act="explore">城中寻访<small>城池基因 ${genes} / ${GENE_COUNT}</small></button>` : ''}
        <button data-act="close">关闭</button>
      </div>`;
    card.hidden = false;
    card.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        sound.click();
        const act = b.dataset.act;
        if (act === 'lesson') void nav.go(`?lesson=${l.id}`);
        else if (act === 'explore') void nav.city(l.id);
        else card.hidden = true;
      }),
    );
  };
  card.addEventListener('click', (e) => {
    if (e.target === card) card.hidden = true;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') card.hidden = true;
  });

  root.querySelectorAll<HTMLButtonElement>('.ov-city').forEach((b) => {
    const i = Number(b.dataset.i);
    const l = LESSONS[i];
    b.addEventListener('pointerenter', () => sound.tick());
    b.addEventListener('click', () => {
      if (!unlocked[i]) {
        b.classList.remove('shake');
        void b.offsetWidth;
        b.classList.add('shake');
        return;
      }
      sound.click();
      openCard(l);
    });
  });
  root.querySelector<HTMLButtonElement>('.ov-compare')!.addEventListener('click', () => void nav.compare());
  root.querySelector<HTMLButtonElement>('.ov-back')!.addEventListener('click', () => void nav.home());
  await root.querySelector<HTMLImageElement>('.ov-map img')!.decode().catch(() => {});
  document.body.classList.add('ready');
  await nav.arrive();

  if (fresh.length) {
    // 解锁动画：印章盖下来
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...fresh]));
    } catch {
      // 忽略
    }
    for (const id of fresh) {
      const b = root.querySelector<HTMLElement>(`.ov-city[data-i="${LESSONS.findIndex((l) => l.id === id)}"]`);
      b?.classList.add('stamp');
      sound.click();
    }
  }
}
