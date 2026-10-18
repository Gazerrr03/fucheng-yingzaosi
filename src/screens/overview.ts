// 三城总览：总览舆图 + 三座城的入口与进度 + 三城对比入口。

import { assetUrl, fetchLevel } from '../game/assets';
import { CITIES, GENE_COUNT, cityLitGenes } from '../game/cities';
import { Progress } from '../game/progress';
import type { Nav } from './nav';
import { sound } from '../audio/sound';
import { LESSONS, lessonProgress } from '../plan/lessons';
import { loadReputation } from '../game/progress';

const MAP_W = 1536, MAP_H = 1024;

export async function runOverview(nav: Nav): Promise<void> {
  const progress = new Progress();
  const levels = await Promise.all(CITIES.map((c) => fetchLevel(c.id)));
  const lit = levels.map((d) => cityLitGenes(d, progress).length);
  const allDone = lit.every((n) => n === GENE_COUNT);
  const lessons = lessonProgress();
  const reputation = loadReputation();

  const root = document.createElement('div');
  root.className = 'overview';
  root.innerHTML = `
    <div class="ov-map" style="aspect-ratio: ${MAP_W} / ${MAP_H}">
      <img src="${assetUrl('maps/overview')}" alt="">
      ${CITIES.map((c, i) => `
        <button class="ov-city ${lit[i] === GENE_COUNT ? 'done' : ''}" data-id="${c.id}"
          style="left: ${(c.overview[0] / MAP_W) * 100}%; top: ${(c.overview[1] / MAP_H) * 100}%">
          <span class="ov-seal"><img src="${assetUrl(`ui/seal_${c.id}`)}" alt=""><b>${c.name.slice(0, 2).split('').join('<br>')}</b></span>
          <span class="ov-label">
            <strong>${c.name}</strong>
            <em>${c.blurb}</em>
            <span class="ov-progress">城池基因 ${lit[i]} / ${GENE_COUNT}${lit[i] === GENE_COUNT ? ' · 已通关' : ''}</span>
          </span>
        </button>`).join('')}
    </div>
    <aside class="ov-intro">
      <h1>明代府城<br>规划基因</h1>
      <p>规划基因指规划遗产中的建成遗产所反映的规划智慧中，能够稳定遗传的核心要素。</p>
      <p>研究从 167 座明代府城的统计中归纳出七种规划基因：山水格局、城池平面形状、城墙周回、城门数量、坛庙位置、府署位置、城墙高厚。</p>
      <p class="ov-hint">选择一座府城，在城中寻访，点亮它的七项基因。</p>
      <h2 class="ov-sub">经典模式 · 营建课</h2>
      <ol class="ov-lessons">${LESSONS.map((l) => {
        const rec = lessons[l.id];
        return `<li><button data-lesson="${l.id}" class="${rec?.done ? 'done' : ''}">
          <i>${l.ordinal}</i><span><b>${l.cityName} · ${l.title}</b><em>${rec?.done ? `已过关 · ${rec.grade}` : l.blurb}</em></span></button></li>`;
      }).join('')}</ol>
      ${reputation.length ? `<p class="ov-rep"><b>声望</b>${reputation.map((r) => `<span title="${r.source}">${r.name}</span>`).join('')}</p>` : ''}
      <button class="ov-custom">自定义模式 · 真实地图筑城<small>在重庆等真实山水上自由营建</small></button>
      <button class="ov-compare" ${allDone ? '' : 'disabled'}>
        三城对比${allDone ? '' : `<small>三城全部通关后开启（${lit.filter((n) => n === GENE_COUNT).length} / 3）</small>`}
      </button>
    </aside>
  `;
  document.body.appendChild(root);
  sound.ambient(['wind']);
  root.querySelectorAll<HTMLButtonElement>('.ov-city').forEach((b) => {
    b.addEventListener('click', () => {
      sound.click();
      void nav.city(b.dataset.id!);
    });
    b.addEventListener('pointerenter', () => sound.tick());
  });
  root.querySelector<HTMLButtonElement>('.ov-compare')!.addEventListener('click', () => void nav.compare());
  root.querySelectorAll<HTMLButtonElement>('[data-lesson]').forEach((b) =>
    b.addEventListener('click', () => {
      sound.click();
      void nav.go(`?lesson=${b.dataset.lesson}`);
    }),
  );
  root.querySelector<HTMLButtonElement>('.ov-custom')!.addEventListener('click', () => {
    sound.click();
    void nav.go('?custom=chongqing');
  });
  await root.querySelector<HTMLImageElement>('.ov-map img')!.decode().catch(() => {});
  document.body.classList.add('ready');
  await nav.arrive();
}
