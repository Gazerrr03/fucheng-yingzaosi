// 3D 地块旁的浮窗：地点简介 + 关联的基因 / 拾遗卡片。
// 看完（滚到底，或停留 3 秒）算「已游览」，由外部决定点亮哪些基因后回调盖章动画。

import { SITE_KIND_LABEL, type Level, type Site } from '../game/level';
import { geneProgress, type CardMap } from '../game/cards';
import { assetUrl } from '../game/assets';
import type { Gene } from './hud';

const DWELL_MS = 3000;

export interface InfoPanelEvents {
  onRead(site: Site): void;
  onBack(): void;
}

export class InfoPanel {
  readonly el: HTMLElement;
  private body!: HTMLElement;
  private site: Site | null = null;
  private dwellTimer = 0;
  private readFired = false;

  constructor(parent: HTMLElement, private level: Level, private genes: Gene[], private cards: CardMap, private events: InfoPanelEvents) {
    this.el = document.createElement('aside');
    this.el.className = 'info-panel';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  get width(): number {
    return this.el.hidden ? 0 : this.el.getBoundingClientRect().width;
  }

  open(site: Site, visited: Set<string>): void {
    this.site = site;
    this.readFired = visited.has(site.id);
    const blurb = this.cards[`site:${site.id}`]?.body;
    this.el.innerHTML = `
      <header>
        <button class="back" title="Esc">← 返回地图</button>
        <span class="kind">${SITE_KIND_LABEL[site.kind]}${this.readFired ? ' · 已游览' : ''}</span>
        <h2>${site.name}</h2>
        ${blurb ? `<p class="lead">${blurb}</p>` : ''}
      </header>
      <div class="cards">${site.cards.map((ref) => this.renderCard(ref, visited)).join('')}</div>
      <footer class="read-hint">${this.readFired ? '' : '读完本页即可点亮相关印记'}</footer>
    `;
    this.body = this.el.querySelector('.cards')!;
    this.el.querySelector('.back')!.addEventListener('click', () => this.events.onBack());
    this.el.hidden = false;
    this.el.scrollTop = 0;
    this.el.classList.remove('enter');
    void this.el.offsetWidth;
    this.el.classList.add('enter');

    if (!this.readFired) {
      window.clearTimeout(this.dwellTimer);
      this.dwellTimer = window.setTimeout(() => this.fireRead(), DWELL_MS);
      this.el.onscroll = () => {
        if (this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 8) this.fireRead();
      };
    }
  }

  close(): void {
    window.clearTimeout(this.dwellTimer);
    this.el.onscroll = null;
    this.el.hidden = true;
    this.site = null;
  }

  /** 外部算出新点亮的基因后调用：对应卡片盖章，多地点基因更新进度。 */
  stamp(freshGenes: string[], visited: Set<string>): void {
    for (const sec of this.body.querySelectorAll<HTMLElement>('section[data-gene]')) {
      const id = sec.dataset.gene!;
      const p = geneProgress(this.level, id, visited);
      const prog = sec.querySelector<HTMLElement>('.progress');
      if (prog && p) prog.textContent = p.seen >= p.need ? '已点亮' : `进度 ${p.seen} / ${p.need}`;
      if (freshGenes.includes(id)) sec.classList.add('stamped');
    }
    for (const sec of this.body.querySelectorAll<HTMLElement>('section[data-lore]')) sec.classList.add('collected');
    const hint = this.el.querySelector('.read-hint');
    if (hint) hint.textContent = freshGenes.length ? `点亮：${freshGenes.map((g) => this.genes.find((x) => x.id === g)?.name).join('、')}` : '';
  }

  private fireRead(): void {
    if (this.readFired || !this.site) return;
    this.readFired = true;
    window.clearTimeout(this.dwellTimer);
    this.events.onRead(this.site);
  }

  private renderCard(ref: string, visited: Set<string>): string {
    const [type, id] = ref.split(':');
    const card = this.cards[ref];
    if (!card) return '';
    const quote = card.quote ? `<blockquote>${card.quote.text}<cite>${card.quote.source}</cite></blockquote>` : '';
    const later = card.later ? `<p class="later"><b>后世</b>${card.later}</p>` : '';
    const flag = card.flag ? `<p class="flag">此处数据待核（资料问题报告 #${card.flag}），暂按原文占位。</p>` : '';
    const sources = card.sources?.length ? `<p class="sources">出处：${card.sources.join('、')}</p>` : '';
    if (type === 'gene') {
      const gene = this.genes.find((g) => g.id === id);
      const p = geneProgress(this.level, id, visited);
      const lit = p ? p.seen >= p.need : false;
      const progress = p && p.need > 1 ? `<span class="progress">${lit ? '已点亮' : `进度 ${p.seen} / ${p.need}`}</span>` : '';
      return `
        <section data-gene="${id}" class="${lit ? 'stamped done' : ''}">
          <div class="tag gene">城池基因 · ${gene?.name ?? id}${progress}</div>
          <img class="stamp" src="${assetUrl(`ui/${gene?.icon ?? 'icon_gene_off'}`)}" alt="">
          <h3>${card.title}</h3>
          <p>${card.body}</p>${quote}${later}${flag}${sources}
        </section>`;
    }
    return `
      <section data-lore="${id}" class="${visited.has(this.site?.id ?? '') ? 'collected' : ''}">
        <div class="tag lore">拾遗</div>
        <h3>${card.title}</h3>
        <p>${card.body}</p>${quote}${later}${flag}${sources}
      </section>`;
  }
}
