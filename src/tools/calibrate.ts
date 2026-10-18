// 标定工具（仅开发期使用）：在现有底图上标参考点、刷地形、放地点、写标注，保存回 public/data/{city}.json。
// 打开方式：npm run dev 后访问 /tools/calibrate/?city=xiangyang

import './calibrate.css';
import { createContext, loadTexture, type Texture } from '../render/gl';
import { applyH, type Vec2 } from '../scene/homography';
import { hexKey, neighbors, type Hex } from '../scene/hex';
import { assetUrl, fetchLevel, loadMarkerTextures } from '../game/assets';
import { buildLevel, imageScale, SITE_KIND_LABEL, terrainName, type Level, type LevelJSON, type SiteJSON, type SiteKind } from '../game/level';
import { encodeTerrain, TERRAINS } from '../game/terrain';
import { MapView, type HoverInfo } from '../view/mapView';

type Mode = 'points' | 'terrain' | 'sites' | 'labels';

const MODES: { id: Mode; name: string; help: string }[] = [
  { id: 'points', name: '参考点', help: '拖动地图上的红色手柄，对准画面里的参考位置；右侧填写它的世界坐标（米，x 向东、y 向北）。至少 4 个点，多于 4 个时按最小二乘求解，残差会显示在每个点后面。' },
  { id: 'terrain', name: '地形', help: '选一种地形后在地图上按住左键刷。数字键 1–8 切换地形，0 为擦除，[ ] 调整笔刷大小。' },
  { id: 'sites', name: '地点', help: '在列表里选中一个地点，然后在地图上点击画面中对应的建筑位置。地点会吸附到所在的格；两个地点不能落在同一格。' },
  { id: 'labels', name: '标注', help: '点击一个格，在右侧输入名称（坊名、桥名、村名等），回车确认；清空名称即删除。标注只用于悬停提示。' },
];

const SITE_KINDS = Object.keys(SITE_KIND_LABEL) as SiteKind[];

class Calibrator {
  private data!: LevelJSON;
  private level!: Level;
  private view!: MapView;
  private mapTex!: Texture;
  private mode: Mode = 'points';
  private brush = 'T';
  private brushRadius = 0;
  private selectedSite: string | null = null;
  private selectedHex: Hex | null = null;
  private history: string[] = [];
  private savedSnapshot = '';
  private strokeOpen = false;
  private handles = document.querySelector<HTMLElement>('#handles')!;
  private panel = document.querySelector<HTMLElement>('#panel')!;
  private hoverBox = document.querySelector<HTMLElement>('#hover-info')!;
  private status = '';

  constructor(private city: string) {}

  async init(): Promise<void> {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    const gl = createContext(canvas);
    this.data = await fetchLevel(this.city);
    const [mapTex, markers] = await Promise.all([loadTexture(gl, assetUrl(this.data.map)), loadMarkerTextures(gl)]);
    this.mapTex = mapTex;
    this.level = buildLevel(this.data, [mapTex.width, mapTex.height]);
    this.savedSnapshot = JSON.stringify(this.data);
    this.view = new MapView(gl, canvas, this.level, mapTex, markers, {
      onHover: (info) => this.showHover(info),
      onEditDown: (info) => this.editAt(info, true),
      onEditDrag: (info) => this.editAt(info, false),
      onEditUp: () => this.endStroke(),
    }, { editable: true });

    this.bindKeys();
    this.setMode('points');
    window.addEventListener('beforeunload', (e) => {
      if (this.dirty) e.preventDefault();
    });

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.view.frame(dt);
      this.updateHandles();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private get dirty(): boolean {
    return JSON.stringify(this.data) !== this.savedSnapshot;
  }

  // ---------- 数据变更 ----------

  /** 改数据之前调用：记一次撤销点。 */
  private checkpoint(): void {
    this.history.push(JSON.stringify(this.data));
    if (this.history.length > 200) this.history.shift();
  }

  private rebuild(renderPanel = true): void {
    this.level = buildLevel(this.data, [this.mapTex.width, this.mapTex.height]);
    this.view.setLevel(this.level);
    if (renderPanel) this.renderPanel();
    else this.renderStatus();
  }

  private undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.data = JSON.parse(prev);
    this.rebuild();
  }

  private async save(): Promise<void> {
    const body = JSON.stringify(this.data);
    try {
      const res = await fetch(`/__save/${this.city}`, { method: 'POST', body });
      if (!res.ok) throw new Error(await res.text());
      this.savedSnapshot = body;
      this.status = `已保存 ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      this.status = `保存失败：${err instanceof Error ? err.message : err}`;
    }
    this.renderStatus();
  }

  private download(): void {
    const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.city}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- 地图上的编辑 ----------

  private editAt(info: HoverInfo, isDown: boolean): void {
    if (this.mode === 'terrain') {
      if (isDown) {
        this.checkpoint();
        this.strokeOpen = true;
      }
      if (!this.strokeOpen) return;
      const cells = [info.hex, ...(this.brushRadius > 0 ? neighbors(info.hex) : [])];
      const map = new Map(this.level.terrain);
      let changed = false;
      for (const h of cells) {
        const key = hexKey(h);
        const cur = map.get(key);
        if (this.brush === '.') {
          if (cur !== undefined) { map.delete(key); changed = true; }
        } else if (cur !== this.brush) {
          map.set(key, this.brush);
          changed = true;
        }
      }
      if (changed) {
        this.data.terrain = encodeTerrain(map, this.data.terrain?.note);
        this.rebuild(false);
      }
      return;
    }
    if (!isDown) return;
    if (this.mode === 'sites') {
      const site = this.data.sites.find((s) => s.id === this.selectedSite);
      if (!site) return;
      this.checkpoint();
      const k = imageScale(this.data, this.level.imageSize);
      site.img = [Math.round(info.img[0] / k), Math.round(info.img[1] / k)];
      this.rebuild();
    } else if (this.mode === 'labels') {
      this.selectedHex = info.hex;
      this.view.select(info.hex);
      this.renderPanel();
      this.panel.querySelector<HTMLInputElement>('#label-input')?.focus();
    }
  }

  private endStroke(): void {
    if (this.strokeOpen) {
      this.strokeOpen = false;
      // 一笔没改动任何格时，撤掉刚记的撤销点
      if (this.history[this.history.length - 1] === JSON.stringify(this.data)) this.history.pop();
      this.renderPanel();
    }
  }

  // ---------- 参考点手柄 ----------

  private updateHandles(): void {
    const els = this.handles.children;
    const pts = this.data.calibration.points;
    const show = this.mode === 'points';
    let i = 0;
    if (show) {
      for (; i < pts.length; i++) {
        let el = els[i] as HTMLElement | undefined;
        if (!el) {
          el = document.createElement('div');
          el.className = 'handle';
          this.bindHandle(el);
          this.handles.appendChild(el);
        }
        el.dataset.index = String(i);
        el.textContent = pts[i].label ?? `点 ${i + 1}`;
        const k = imageScale(this.data, this.level.imageSize);
        const [x, y] = this.view.imageToCss([pts[i].img[0] * k, pts[i].img[1] * k]);
        el.style.transform = `translate(${x}px, ${y}px)`;
      }
    }
    while (els.length > i) els[els.length - 1].remove();
  }

  private bindHandle(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const index = Number(el.dataset.index);
      this.checkpoint();
      el.setPointerCapture(e.pointerId);
      el.classList.add('active');
      const move = (ev: PointerEvent) => {
        const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
        const rect = canvas.getBoundingClientRect();
        const dpr = canvas.width / rect.width;
        const img = this.view.camera.screenToImage([(ev.clientX - rect.left) * dpr, (ev.clientY - rect.top) * dpr]);
        const k = imageScale(this.data, this.level.imageSize);
        this.data.calibration.points[index].img = [Math.round(img[0] / k), Math.round(img[1] / k)];
        this.rebuild(false);
      };
      const up = () => {
        el.classList.remove('active');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        this.renderPanel();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  // ---------- 键盘 ----------

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void this.save();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !typing) {
        e.preventDefault();
        this.undo();
        return;
      }
      if (typing || this.mode !== 'terrain') return;
      if (e.key === '0') this.setBrush('.');
      const n = Number(e.key);
      if (n >= 1 && n <= TERRAINS.length) this.setBrush(TERRAINS[n - 1].code);
      if (e.key === '[') { this.brushRadius = 0; this.renderPanel(); }
      if (e.key === ']') { this.brushRadius = 1; this.renderPanel(); }
    });
  }

  private setBrush(code: string): void {
    this.brush = code;
    this.renderPanel();
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.view.overlay = mode === 'terrain' ? 0.55 : mode === 'labels' ? 0.2 : 0;
    this.view.select(null);
    this.selectedHex = null;
    if (mode === 'sites' && this.selectedSite) this.selectSite(this.selectedSite, false);
    document.body.dataset.mode = mode;
    this.renderPanel();
  }

  private selectSite(id: string, fly = true): void {
    this.selectedSite = id;
    const site = this.level.sites.find((s) => s.id === id);
    if (site) {
      this.view.select(site.hex);
      if (fly) this.view.camera.flyTo(site.img);
    } else {
      this.view.select(null);
    }
    this.renderPanel();
  }

  // ---------- 悬停信息 ----------

  private showHover(info: HoverInfo | null): void {
    if (!info) {
      this.hoverBox.textContent = '';
      return;
    }
    const t = terrainName(this.level, info.terrain) ?? '未标注';
    const w = applyH(this.level.imgToWorld, info.img);
    this.hoverBox.innerHTML = [
      `格 <b>${info.hex.q}, ${info.hex.r}</b>`,
      `地形 <b>${t}</b>`,
      info.label ? `标注 <b>${info.label}</b>` : '',
      info.site ? `地点 <b>${info.site.name}</b>` : '',
      `图像 ${Math.round(info.img[0])}, ${Math.round(info.img[1])}`,
      `世界 ${Math.round(w[0])}, ${Math.round(w[1])} m`,
    ].filter(Boolean).join('　');
  }

  // ---------- 侧栏 ----------

  private renderStatus(): void {
    const el = this.panel.querySelector('.status');
    if (el) el.textContent = this.dirty ? `有未保存的改动${this.status ? ` · ${this.status}` : ''}` : this.status || '与文件一致';
    el?.classList.toggle('dirty', this.dirty);
  }

  private renderPanel(): void {
    const mode = MODES.find((m) => m.id === this.mode)!;
    this.panel.innerHTML = `
      <header>
        <h1>标定工具 <small>${this.data.name}</small></h1>
        <div class="actions">
          <button data-act="save" title="⌘/Ctrl + S">保存</button>
          <button data-act="undo" title="⌘/Ctrl + Z" ${this.history.length ? '' : 'disabled'}>撤销</button>
          <button data-act="download">下载 JSON</button>
        </div>
        <p class="status"></p>
      </header>
      <nav class="tabs">${MODES.map((m) => `<button data-mode="${m.id}" class="${m.id === this.mode ? 'on' : ''}">${m.name}</button>`).join('')}</nav>
      <p class="help">${mode.help}<br><span class="muted">平移：右键 / 中键 / 空格 + 左键拖拽 · 缩放：滚轮</span></p>
      <section class="body">${this.renderModeBody()}</section>
      ${this.level.issues.length ? `<section class="issues"><h3>数据问题</h3><ul>${this.level.issues.map((i) => `<li>${i}</li>`).join('')}</ul></section>` : ''}
    `;
    this.renderStatus();
    this.bindPanel();
  }

  private renderModeBody(): string {
    switch (this.mode) {
      case 'points': {
        const rows = this.data.calibration.points.map((p, i) => {
          const k = imageScale(this.data, this.level.imageSize);
          const w = applyH(this.level.imgToWorld, [p.img[0] * k, p.img[1] * k]);
          const err = Math.hypot(w[0] - p.world[0], w[1] - p.world[1]);
          return `<tr data-i="${i}">
            <td><input class="pt-label" value="${p.label ?? ''}" placeholder="点 ${i + 1}"></td>
            <td><input class="pt-wx num" type="number" step="10" value="${p.world[0]}"></td>
            <td><input class="pt-wy num" type="number" step="10" value="${p.world[1]}"></td>
            <td class="muted">${p.img[0]}, ${p.img[1]}</td>
            <td class="${err > 30 ? 'warn' : 'muted'}">${err.toFixed(1)}</td>
            <td><button class="pt-del" ${this.data.calibration.points.length <= 4 ? 'disabled' : ''}>×</button></td>
          </tr>`;
        }).join('');
        return `
          <table class="points">
            <thead><tr><th>名称</th><th>x 东</th><th>y 北</th><th>图像</th><th>残差 m</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <button data-act="add-point">添加参考点（视图中心）</button>
          <label class="field">格子对边距离（米）<input id="hex-across" class="num" type="number" step="10" value="${this.data.grid.hexAcross}"></label>`;
      }
      case 'terrain': {
        const counts = new Map<string, number>();
        for (const c of this.level.terrain.values()) counts.set(c, (counts.get(c) ?? 0) + 1);
        return `
          <div class="palette">
            ${TERRAINS.map((t, i) => `<button data-brush="${t.code}" class="${this.brush === t.code ? 'on' : ''}">
              <i style="background: rgb(${t.color.join(',')})"></i>${i + 1} ${t.name}<span class="muted">${counts.get(t.code) ?? 0}</span></button>`).join('')}
            <button data-brush="." class="${this.brush === '.' ? 'on' : ''}"><i class="erase"></i>0 擦除</button>
          </div>
          <div class="radio">笔刷
            <button data-radius="0" class="${this.brushRadius === 0 ? 'on' : ''}">单格 [</button>
            <button data-radius="1" class="${this.brushRadius === 1 ? 'on' : ''}">七格 ]</button>
          </div>`;
      }
      case 'sites': {
        const site = this.data.sites.find((s) => s.id === this.selectedSite);
        const placed = new Set(this.level.sites.map((s) => s.id));
        const list = this.data.sites.map((s) => `
          <li data-id="${s.id}" class="${s.id === this.selectedSite ? 'on' : ''} ${placed.has(s.id) ? '' : 'bad'}">
            <span>${s.name}</span><span class="muted">${SITE_KIND_LABEL[s.kind]}</span></li>`).join('');
        const form = site
          ? `<div class="site-form">
              <label class="field">ID<input id="site-id" value="${site.id}"></label>
              <label class="field">名称<input id="site-name" value="${site.name}"></label>
              <label class="field">类型<select id="site-kind">${SITE_KINDS.map((k) => `<option value="${k}" ${k === site.kind ? 'selected' : ''}>${SITE_KIND_LABEL[k]}</option>`).join('')}</select></label>
              <label class="field">卡片（逗号分隔）<input id="site-cards" value="${site.cards.join(', ')}"></label>
              <label class="field">主体朝向（度，留空 = 自动；城角等特殊构件才需要填）<input id="site-rot" class="num" type="number" step="15" value="${site.rotY ?? ''}"></label>
              <p class="muted">底图位置 ${site.img[0]}, ${site.img[1]} · 在地图上左键点击可重新放置</p>
              <button data-act="del-site" class="danger">删除地点</button>
            </div>`
          : '<p class="muted">在列表里选中一个地点。</p>';
        return `<ul class="site-list">${list}</ul><button data-act="add-site">新建地点（视图中心）</button>${form}`;
      }
      case 'labels': {
        const h = this.selectedHex;
        const cur = h ? this.level.labels.get(hexKey(h)) ?? '' : '';
        const list = (this.data.labels ?? []).map((l) => `<li data-q="${l.hex[0]}" data-r="${l.hex[1]}"><span>${l.name}</span><span class="muted">${l.hex[0]}, ${l.hex[1]}</span></li>`).join('');
        return `
          ${h ? `<label class="field">格 ${h.q}, ${h.r} 的名称<input id="label-input" value="${cur}" placeholder="例如：攀桂坊"></label>` : '<p class="muted">在地图上点击一个格。</p>'}
          <ul class="site-list">${list}</ul>`;
      }
    }
  }

  private bindPanel(): void {
    const $ = <T extends HTMLElement>(sel: string) => this.panel.querySelector<T>(sel);
    this.panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode as Mode)));
    this.panel.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        switch (b.dataset.act) {
          case 'save': void this.save(); break;
          case 'undo': this.undo(); break;
          case 'download': this.download(); break;
          case 'add-point': {
            this.checkpoint();
            const c = this.view.camera.center;
            const w = applyH(this.level.imgToWorld, c);
            const k = imageScale(this.data, this.level.imageSize);
            this.data.calibration.points.push({ img: [Math.round(c[0] / k), Math.round(c[1] / k)], world: [Math.round(w[0]), Math.round(w[1])], label: `点 ${this.data.calibration.points.length + 1}` });
            this.rebuild();
            break;
          }
          case 'add-site': {
            this.checkpoint();
            const c = this.view.camera.center;
            let n = this.data.sites.length + 1;
            while (this.data.sites.some((s) => s.id === `site${n}`)) n++;
            const k = imageScale(this.data, this.level.imageSize);
            this.data.sites.push({ id: `site${n}`, name: `新地点 ${n}`, kind: 'landmark', img: [Math.round(c[0] / k), Math.round(c[1] / k)], cards: [] });
            this.selectedSite = `site${n}`;
            this.rebuild();
            this.selectSite(`site${n}`, false);
            break;
          }
          case 'del-site': {
            if (!this.selectedSite) break;
            this.checkpoint();
            this.data.sites = this.data.sites.filter((s) => s.id !== this.selectedSite);
            this.selectedSite = null;
            this.view.select(null);
            this.rebuild();
            break;
          }
        }
      }),
    );

    // 参考点表格
    this.panel.querySelectorAll<HTMLTableRowElement>('table.points tbody tr').forEach((tr) => {
      const i = Number(tr.dataset.i);
      const p = this.data.calibration.points[i];
      tr.querySelector<HTMLInputElement>('.pt-label')!.addEventListener('change', (e) => { this.checkpoint(); p.label = (e.target as HTMLInputElement).value; this.rebuild(); });
      tr.querySelector<HTMLInputElement>('.pt-wx')!.addEventListener('change', (e) => { this.checkpoint(); p.world[0] = Number((e.target as HTMLInputElement).value); this.rebuild(); });
      tr.querySelector<HTMLInputElement>('.pt-wy')!.addEventListener('change', (e) => { this.checkpoint(); p.world[1] = Number((e.target as HTMLInputElement).value); this.rebuild(); });
      tr.querySelector<HTMLButtonElement>('.pt-del')!.addEventListener('click', () => {
        this.checkpoint();
        this.data.calibration.points.splice(i, 1);
        this.rebuild();
      });
    });
    $<HTMLInputElement>('#hex-across')?.addEventListener('change', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (v >= 50) { this.checkpoint(); this.data.grid.hexAcross = v; this.rebuild(); }
    });

    // 地形
    this.panel.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach((b) => b.addEventListener('click', () => this.setBrush(b.dataset.brush!)));
    this.panel.querySelectorAll<HTMLButtonElement>('[data-radius]').forEach((b) => b.addEventListener('click', () => { this.brushRadius = Number(b.dataset.radius); this.renderPanel(); }));

    // 地点
    this.panel.querySelectorAll<HTMLLIElement>('.site-list li[data-id]').forEach((li) => li.addEventListener('click', () => this.selectSite(li.dataset.id!)));
    const site = this.data.sites.find((s) => s.id === this.selectedSite);
    if (site) {
      const bind = (sel: string, apply: (v: string, s: SiteJSON) => boolean | void) =>
        $<HTMLInputElement | HTMLSelectElement>(sel)?.addEventListener('change', (e) => {
          const v = (e.target as HTMLInputElement).value.trim();
          this.checkpoint();
          if (apply(v, site) === false) { this.history.pop(); this.renderPanel(); return; }
          this.rebuild();
        });
      bind('#site-id', (v, s) => {
        if (!/^[a-z][a-z0-9_]*$/.test(v) || this.data.sites.some((o) => o !== s && o.id === v)) {
          this.status = 'ID 只能用小写字母、数字、下划线，且不能重复';
          return false;
        }
        s.id = v;
        this.selectedSite = v;
      });
      bind('#site-name', (v, s) => { s.name = v; });
      bind('#site-kind', (v, s) => { s.kind = v as SiteKind; });
      bind('#site-cards', (v, s) => { s.cards = v.split(/[,，\s]+/).filter(Boolean); });
      bind('#site-rot', (v, s) => {
        if (v === '') delete s.rotY;
        else s.rotY = Number(v);
      });
    }

    // 标注
    this.panel.querySelectorAll<HTMLLIElement>('.site-list li[data-q]').forEach((li) =>
      li.addEventListener('click', () => {
        const h = { q: Number(li.dataset.q), r: Number(li.dataset.r) };
        this.selectedHex = h;
        this.view.select(h);
        const center = applyH(this.level.worldToImg, [this.level.hexSize * Math.sqrt(3) * (h.q + h.r / 2), this.level.hexSize * 1.5 * h.r] as Vec2);
        this.view.camera.flyTo(center);
        this.renderPanel();
      }),
    );
    $<HTMLInputElement>('#label-input')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !this.selectedHex) return;
      const name = (e.target as HTMLInputElement).value.trim();
      const h = this.selectedHex;
      this.checkpoint();
      const labels = (this.data.labels ?? []).filter((l) => !(l.hex[0] === h.q && l.hex[1] === h.r));
      if (name) labels.push({ hex: [h.q, h.r], name });
      this.data.labels = labels;
      this.rebuild();
    });
  }
}

const city = new URLSearchParams(location.search).get('city') ?? 'xiangyang';
new Calibrator(city).init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<p class="fatal">加载失败：${err.message ?? err}</p>`);
});
