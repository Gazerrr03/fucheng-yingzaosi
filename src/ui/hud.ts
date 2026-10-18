// 地图界面的 DOM 层：城名、基因面板、拾遗计数、悬停提示、地点预览卡、通关印章。

import { SITE_KIND_LABEL, terrainName, type Level, type Site } from '../game/level';
import { geneProgress, litGenes, type CardMap } from '../game/cards';
import { assetUrl } from '../game/assets';
import type { HoverInfo } from '../view/mapView';

export interface Gene {
  id: string;
  name: string;
  icon: string;
}

export interface HudActions {
  onEnter(site: Site): void;
  onCloseSite(): void;
  onReset(): void;
  onHome(): void;
  onCompare(): void;
}

export class Hud {
  private tooltip: HTMLElement;
  private card: HTMLElement;
  private geneEls = new Map<string, HTMLElement>();
  private progressEl: HTMLElement;
  private loreEl: HTMLElement;
  private sealEl: HTMLElement;
  private lit = new Set<string>();

  constructor(private root: HTMLElement, private level: Level, private genes: Gene[], private cards: CardMap, private actions: HudActions) {
    root.innerHTML = `
      <header class="title-card">
        <button class="home" title="返回经典舆图">← 经典舆图</button>
        <h1>${level.data.name}</h1>
        <p>${level.data.subtitle}</p>
      </header>
      <aside class="gene-panel">
        <div class="gene-head"><span>城池基因</span><b class="gene-progress"></b></div>
        <ul class="gene-list"></ul>
        <div class="lore-count"></div>
        <button class="reset" title="清空本城的收集进度">重置进度</button>
      </aside>
      <div class="hint">拖拽平移 · 滚轮缩放 · 点击徽记查看地点</div>
      <div class="tooltip" hidden></div>
      <section class="site-card" hidden></section>
      <div class="complete-seal" hidden>
        <div class="seal-stamp"><img src="${assetUrl(`ui/seal_${level.data.id}`)}" alt=""><span>${level.data.name.split('').join('<br>')}</span></div>
        <p>七项城池基因已全部点亮</p>
        <div class="seal-actions"><button class="continue">继续游览</button><button class="compare" hidden>查看三城对比</button><button class="go-home">返回舆图</button></div>
      </div>
    `;
    this.tooltip = root.querySelector('.tooltip')!;
    this.card = root.querySelector('.site-card')!;
    this.progressEl = root.querySelector('.gene-progress')!;
    this.loreEl = root.querySelector('.lore-count')!;
    this.sealEl = root.querySelector('.complete-seal')!;
    this.sealEl.querySelector('.continue')!.addEventListener('click', () => (this.sealEl.hidden = true));
    this.sealEl.querySelector('.compare')!.addEventListener('click', () => actions.onCompare());
    this.sealEl.querySelector('.go-home')!.addEventListener('click', () => actions.onHome());
    root.querySelector('.home')!.addEventListener('click', () => actions.onHome());
    root.querySelector('.reset')!.addEventListener('click', () => {
      if (confirm(`清空${level.data.name}的收集进度？`)) actions.onReset();
    });
    const list = root.querySelector('.gene-list')!;
    for (const g of genes) {
      const li = document.createElement('li');
      li.className = 'gene';
      li.innerHTML = `
        <span class="seal"><img class="on" src="${assetUrl(`ui/${g.icon}`)}" alt=""><img class="off" src="${assetUrl('ui/icon_gene_off')}" alt=""></span>
        <span class="gene-name">${g.name}</span><small class="gene-count"></small>`;
      list.appendChild(li);
      this.geneEls.set(g.id, li);
    }
  }

  /** 按已看过的地点刷新基因与拾遗；返回本次新点亮的基因。 */
  setProgress(visited: Set<string>, animate = false): string[] {
    const now = new Set(litGenes(this.level, visited));
    const fresh = [...now].filter((g) => !this.lit.has(g));
    for (const [id, el] of this.geneEls) {
      el.classList.toggle('lit', now.has(id));
      const p = geneProgress(this.level, id, visited);
      const count = el.querySelector<HTMLElement>('.gene-count')!;
      count.textContent = p && p.need > 1 && !now.has(id) ? `${p.seen}/${p.need}` : '';
      if (animate && fresh.includes(id)) {
        el.classList.remove('stamping');
        void el.offsetWidth;
        el.classList.add('stamping');
      }
    }
    this.lit = now;
    this.progressEl.textContent = `${now.size} / ${this.genes.length}`;

    const loreIds = this.level.data.lore.map((l) => l.id);
    const seenLore = new Set(
      this.level.sites.filter((s) => visited.has(s.id)).flatMap((s) => s.cards.filter((c) => c.startsWith('lore:')).map((c) => c.slice(5))),
    );
    this.loreEl.textContent = `拾遗 ${loreIds.filter((l) => seenLore.has(l)).length} / ${loreIds.length}`;
    return fresh;
  }

  get complete(): boolean {
    return this.lit.size === this.genes.length;
  }

  /** allCities：三城是否都已通关（决定是否显示「查看三城对比」） */
  showComplete(allCities = false): void {
    this.sealEl.querySelector<HTMLElement>('.compare')!.hidden = !allCities;
    this.sealEl.hidden = false;
    this.sealEl.classList.remove('show');
    void this.sealEl.offsetWidth;
    this.sealEl.classList.add('show');
  }

  showHover(info: HoverInfo | null): void {
    if (!info) {
      this.tooltip.hidden = true;
      return;
    }
    const { site, screen, label } = info;
    const terrain = terrainName(this.level, info.terrain);
    if (!site && !label && !terrain) {
      this.tooltip.hidden = true;
      return;
    }
    this.tooltip.innerHTML = site
      ? `<b>${site.name}</b><span>${SITE_KIND_LABEL[site.kind]}</span>`
      : label
        ? `<b>${label}</b>${terrain ? `<span>${terrain}</span>` : ''}`
        : `<span class="coord">${terrain}</span>`;
    this.tooltip.classList.toggle('is-site', !!site);
    this.tooltip.style.transform = `translate(${screen[0] + 16}px, ${screen[1] + 18}px)`;
    this.tooltip.hidden = false;
  }

  /** 地点预览卡：点徽记后出现，可进入地块。 */
  showSite(site: Site | null, visited = false): void {
    if (!site) {
      this.card.hidden = true;
      return;
    }
    const blurb = this.cards[`site:${site.id}`]?.body;
    this.card.innerHTML = `
      <button class="close" aria-label="关闭">×</button>
      <span class="kind">${SITE_KIND_LABEL[site.kind]}${visited ? ' · 已游览' : ''}</span>
      <h2>${site.name}</h2>
      ${blurb ? `<p class="blurb">${blurb}</p>` : ''}
      <ul class="refs">${site.cards.map((c) => this.refChip(c)).join('')}</ul>
      <button class="enter">进入地块</button>`;
    this.card.querySelector('.close')!.addEventListener('click', () => this.actions.onCloseSite());
    this.card.querySelector('.enter')!.addEventListener('click', () => this.actions.onEnter(site));
    this.card.hidden = false;
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    if (!v) this.tooltip.hidden = true;
  }

  private refChip(ref: string): string {
    const [type, id] = ref.split(':');
    if (type === 'gene') {
      const g = this.genes.find((x) => x.id === id);
      return `<li class="gene-ref ${this.lit.has(id) ? 'is-lit' : ''}">${g?.name ?? id}</li>`;
    }
    return `<li class="lore-ref">${this.level.data.lore.find((l) => l.id === id)?.name ?? id}</li>`;
  }
}
