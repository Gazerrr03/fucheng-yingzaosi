// 云雾过渡：云从四周向中间合拢遮住画面，加载完成后向外散开。
// 纯 DOM + Web Animations；纸色底板在云合拢的后半段淡入，保证完全遮住。

import { assetUrl } from '../game/assets';
import { sound } from '../audio/sound';

interface Puff {
  el: HTMLImageElement;
  from: [number, number];
  to: [number, number];
  scale: number;
  rot: number;
}

const COUNT = 12;

export class CloudTransition {
  private root: HTMLElement;
  private backdrop: HTMLElement;
  private puffs: Puff[] = [];
  private covered = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'clouds';
    this.root.hidden = true;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'clouds-backdrop';
    this.root.appendChild(this.backdrop);
    for (let i = 0; i < COUNT; i++) {
      const el = document.createElement('img');
      // 厚云为主，每四朵里夹一朵薄雾
      const kind = i % 4 === 3 ? (i % 8 === 3 ? 3 : 4) : (i % 2) + 1;
      el.src = assetUrl(`clouds/cloud_0${kind}`);
      el.className = kind >= 3 ? 'puff wisp' : 'puff';
      el.alt = '';
      this.root.appendChild(el);
      this.puffs.push({ el, from: [0, 0], to: [0, 0], scale: 1, rot: 0 });
    }
    parent.appendChild(this.root);
  }

  /** 每次合拢前重新随机云的位置，避免每次都一样。 */
  private layout(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const R = Math.hypot(w, h) / 2;
    const base = Math.random() * Math.PI * 2;
    this.puffs.forEach((p, i) => {
      const a = base + (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const rIn = R * (0.08 + Math.random() * 0.32);
      const rOut = R * (1.25 + Math.random() * 0.3);
      p.from = [Math.cos(a) * rOut, Math.sin(a) * rOut];
      p.to = [Math.cos(a) * rIn, Math.sin(a) * rIn];
      p.scale = (p.el.classList.contains('wisp') ? 1.2 : 0.9) + Math.random() * 0.6;
      p.rot = (Math.random() - 0.5) * 16;
      p.el.style.width = `${Math.max(w, h) * 0.62}px`;
    });
  }

  private tf([x, y]: [number, number], scale: number, rot: number): string {
    return `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`;
  }

  /** 云合拢；完全遮住后 resolve。 */
  async cover(duration = 900): Promise<void> {
    if (this.covered) return;
    this.layout();
    this.root.hidden = false;
    if (duration > 50) sound.whoosh(false);
    const easing = 'cubic-bezier(0.45, 0, 0.25, 1)';
    const anims = this.puffs.map((p, i) =>
      p.el.animate(
        [
          { transform: this.tf(p.from, p.scale * 0.9, p.rot - 6), opacity: 0 },
          { opacity: 1, offset: 0.35 },
          { transform: this.tf(p.to, p.scale, p.rot), opacity: 1 },
        ],
        { duration: duration + i * 12, easing, fill: 'forwards' },
      ),
    );
    anims.push(this.backdrop.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: duration + COUNT * 12, easing: 'ease-in', fill: 'forwards' }));
    await Promise.all(anims.map((a) => a.finished));
    this.covered = true;
  }

  /** 云散开；完全散开后 resolve。 */
  async reveal(duration = 1100): Promise<void> {
    if (!this.covered) return;
    sound.whoosh(true);
    const easing = 'cubic-bezier(0.3, 0, 0.2, 1)';
    const anims = this.puffs.map((p, i) =>
      p.el.animate(
        [
          { transform: this.tf(p.to, p.scale, p.rot), opacity: 1 },
          { opacity: 1, offset: 0.55 },
          { transform: this.tf(p.from, p.scale * 1.15, p.rot + 6), opacity: 0 },
        ],
        { duration: duration + i * 15, easing, fill: 'forwards' },
      ),
    );
    anims.push(this.backdrop.animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'forwards' }));
    await Promise.all(anims.map((a) => a.finished));
    this.covered = false;
    this.root.hidden = true;
  }
}
