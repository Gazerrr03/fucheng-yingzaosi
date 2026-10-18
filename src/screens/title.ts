// 主界面：进游戏先看到的标题画面，只有两个入口——经典模式（四城营建课）、自定义模式（天下舆图）。

import { assetUrl } from '../game/assets';
import { sound } from '../audio/sound';
import { LESSONS, lessonProgress } from '../plan/lessons';
import { loadFoundings } from '../world/foundings';
import type { Nav } from './nav';

export async function runTitle(nav: Nav): Promise<void> {
  const done = LESSONS.filter((l) => lessonProgress()[l.id]?.done).length;
  const cities = loadFoundings().length;

  const root = document.createElement('div');
  root.className = 'title-screen';
  root.innerHTML = `
    <div class="ts-bg"><img src="${assetUrl('maps/overview')}" alt=""></div>
    <div class="ts-veil"></div>
    <main class="ts-main">
      <p class="ts-kicker">明代府城规划基因</p>
      <h1>府城营造司</h1>
      <p class="ts-lede">相土尝水，象天法地。择一方山水，营一座府城。</p>
      <nav class="ts-menu">
        <button data-go="classic">
          <b>经典模式</b>
          <span>四城营建课 · 由平原到含山，循序解锁</span>
          <small>已过 ${done} / ${LESSONS.length} 课</small>
        </button>
        <button data-go="world" class="primary">
          <b>自定义模式</b>
          <span>天下舆图 · 在真实比例的大明疆域上择址建府</span>
          <small>${cities ? `已建 ${cities} 座府城` : '尚未建城'}</small>
        </button>
      </nav>
    </main>
  `;
  document.body.appendChild(root);
  sound.ambient(['wind']);
  root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => {
    b.addEventListener('pointerenter', () => sound.tick());
    b.addEventListener('click', () => {
      sound.click();
      void (b.dataset.go === 'classic' ? nav.classic() : nav.world());
    });
  });
  await root.querySelector<HTMLImageElement>('.ts-bg img')!.decode().catch(() => {});
  document.body.classList.add('ready');
  await nav.arrive();
}
