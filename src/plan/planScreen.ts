// 营建界面：构件栏 + 视图 + 评价面板 + 底部工具条。经典关卡和自定义模式共用，差别由 PlanSession 描述。

import { hexKey, hexToWorld, type Hex } from '../scene/hex';
import type { Vec2 } from '../scene/homography';
import { sound } from '../audio/sound';
import { BUILDINGS, BUILDING_BY_ID, BUILDING_GROUPS, type BuildingDef } from './buildings';
import { evaluate, evaluateCity, type CityVerdict, type EvalContext, type Verdict, type YiliSummary } from './fengshui';
import { PlanMap } from './planMap';
import { PlanView, hexLine } from './planView';
import { alreadySettled, finishTriggers, liveRecords, placeTriggers, suburb, yiliOutcome, type YiliEvent, type YiliRecord } from './yili';
import { showYili } from './yiliUI';

export interface GoalState {
  text: string;
  done: boolean;
  /** 未完成时的提示 */
  hint?: string;
}

export interface PlanSession {
  map: PlanMap;
  title: string;
  subtitle: string;
  /** 左上角的小标签，例如「经典 · 第一课」 */
  tag: string;
  /** 可用构件（不填为全部） */
  palette?: string[];
  /** 经典关卡的目标；自定义模式不填 */
  goals?(map: PlanMap, v: CityVerdict): GoalState[];
  /** 底部主按钮文字和动作（例如「过关」「修成史书」） */
  finishLabel: string;
  canFinish?(map: PlanMap, v: CityVerdict): boolean;
  onFinish(map: PlanMap, v: CityVerdict, ui: PlanUI): void;
  /** 每次改动后（自动存档用） */
  onChange?(map: PlanMap): void;
  /** 额外的工具条按钮 */
  extraButtons?: { label: string; title?: string; onClick(ui: PlanUI): void }[];
  onHome(): void;
  /** 开场讲解（HTML） */
  intro?: string;
  initialFocus?: { world: Vec2; hexes: number };
  yili?: YiliHooks;
}

/** 议礼（docs/玩法需求_v3_议礼.md）：经典关卡按城提供 */
export interface YiliHooks {
  events: YiliEvent[];
  /** 本场营建已有的议礼记录（本地存档） */
  records: YiliRecord[];
  /** 某张卡是否已在探索模式点亮 */
  unlocked(card: string): boolean;
  exploreHref?: string;
  /** 底图上的旧城墙走向（考成前判定「城形同于史实」用） */
  oldWalls?: Set<string>;
  save(records: YiliRecord[]): void;
  /** 选 A 得声望 */
  onReputation?(name: string, ev: YiliEvent): void;
}

export interface PlanUI {
  view: PlanView;
  refresh(): void;
  toast(text: string): void;
  root: HTMLElement;
}

/** 可以按住拖动连续营建的构件 */
const PAINT_TOOLS = new Set(['wall', 'moat', 'qu']);

export function runPlan(session: PlanSession): PlanUI {
  const { map } = session;
  document.body.classList.add('plan-mode');
  const canvas = document.createElement('canvas');
  canvas.id = 'plan';
  document.body.appendChild(canvas);

  const root = document.createElement('div');
  root.className = 'plan-ui';
  const palette = (session.palette ?? BUILDINGS.map((b) => b.id)).map((id) => BUILDING_BY_ID.get(id)!).filter(Boolean);
  const groups = BUILDING_GROUPS.filter((g) => palette.some((b) => b.group === g));
  root.innerHTML = `
    <header class="plan-title">
      <button class="home">← 返回</button>
      <span class="tag">${session.tag}</span>
      <h1>${session.title}</h1>
      <p>${session.subtitle}</p>
    </header>
    <aside class="plan-palette">
      <div class="tabs">${groups.map((g, i) => `<button data-g="${g}" class="${i ? '' : 'on'}">${g}</button>`).join('')}</div>
      <ul class="items"></ul>
      <button class="tool-remove" title="右键也可拆除">拆　除</button>
      <p class="about"></p>
    </aside>
    <aside class="plan-judge">
      <div class="grade"><b></b><span></span></div>
      <section class="goals" hidden><h3>本课目标</h3><ul></ul></section>
      <section class="yili-rec" hidden><h3>议礼</h3><ul></ul></section>
      <section class="patterns"><h3>格局</h3><ul></ul></section>
      <section class="worst"><h3>可改进</h3><ul></ul></section>
    </aside>
    <div class="plan-tip" hidden></div>
    <div class="plan-hint" hidden></div>
    <footer class="plan-bar">
      <button class="compass on" title="快捷键 C">罗盘</button>
      <button class="lens on" title="选中构件时全图标出每处得分（快捷键 V）">透镜</button>
      <button class="undo" title="Ctrl+Z">撤销</button>
      ${(session.extraButtons ?? []).map((b, i) => `<button class="extra" data-i="${i}" title="${b.title ?? ''}">${b.label}</button>`).join('')}
      <button class="finish">${session.finishLabel}</button>
    </footer>
    <div class="plan-toast" hidden></div>
    <div class="plan-modal" hidden><div class="sheet"></div></div>
  `;
  document.body.appendChild(root);

  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const itemsEl = $<HTMLUListElement>('.items');
  const aboutEl = $<HTMLParagraphElement>('.about');
  const tipEl = $<HTMLDivElement>('.plan-tip');
  const toastEl = $<HTMLDivElement>('.plan-toast');
  let tool: BuildingDef | 'remove' | null = null;
  let group = groups[0];
  const history: ReturnType<PlanMap['snapshot']>[] = [];
  const yiliEvents = session.yili?.events ?? [];
  let yiliRecords: YiliRecord[] = session.yili?.records ?? [];
  let yiliOpen = false;
  const liveYili = () => liveRecords(map, yiliRecords, yiliEvents);
  /** 评价附加条件：由仍然有效的议礼记录推出豁免与修正项 */
  const ctx = (): EvalContext => {
    const o = yiliOutcome(liveYili(), yiliEvents);
    return { exempt: o.exempt, modifiers: o.modifiers };
  };
  let verdict: CityVerdict = evaluateCity(map, ctx());
  let hoverHex: Hex | null = null;
  let hoverScreen: Vec2 = [0, 0];

  const view = new PlanView(canvas, map, {
    paintable: () => tool === 'remove' || (!!tool && PAINT_TOOLS.has(tool.id)),
    onPaint(phase, hexes) {
      paint(phase, hexes);
    },
    onCamera() {
      scheduleLens();
    },
    onHover(h, screen) {
      hoverHex = h;
      hoverScreen = screen;
      updateGhost();
      showTip();
    },
    onClick(h, button) {
      if (button === 2 || tool === 'remove') return void removeAt(h);
      if (tool) return void placeAt(h, tool);
      const b = map.at(h);
      if (b) {
        tool = null;
        aboutEl.textContent = b.about;
      }
    },
  });
  if (session.initialFocus) view.focus(session.initialFocus.world, session.initialFocus.hexes);

  function renderItems() {
    itemsEl.innerHTML = palette
      .filter((b) => b.group === group)
      .map((b) => {
        const n = map.count(b.id);
        return `<li><button data-id="${b.id}" class="${tool !== 'remove' && tool?.id === b.id ? 'on' : ''}">
          <i>${b.glyph}</i><span>${b.name}</span><small>${b.max ? `${n}/${b.max}` : n || ''}</small></button></li>`;
      })
      .join('');
    root.querySelector('.tool-remove')!.classList.toggle('on', tool === 'remove');
  }

  function selectTool(t: BuildingDef | 'remove' | null) {
    tool = tool === t ? null : t;
    aboutEl.textContent = tool && tool !== 'remove' ? tool.about : tool === 'remove' ? '点击或按住拖动拆除；城门、角楼、水门拆除后退回城墙。' : '';
    canvas.classList.toggle('placing', !!tool);
    renderItems();
    updateGhost();
    updateHint();
    updateLens();
  }

  // ---------------------------------------------------------------- 工具提示与风水透镜

  const hintEl = $<HTMLDivElement>('.plan-hint');
  function updateHint() {
    let text = '';
    if (tool === 'remove') text = '拆除：点击或按住拖动 · 右键拖动平移 · Esc 收起';
    else if (tool && PAINT_TOOLS.has(tool.id)) text = `${tool.name}：按住拖动连续营建，首尾相近自动合拢 · 右键或空格拖动平移 · Esc 收起`;
    else if (tool) text = `${tool.name}：${lensOn ? '绿色格得分高，' : ''}点击放置 · 右键拆除 · Esc 收起`;
    hintEl.textContent = text;
    hintEl.hidden = !text;
  }

  let lensOn = true;
  let lensTimer = 0;
  function scheduleLens() {
    if (!view.lens) return;
    clearTimeout(lensTimer);
    lensTimer = window.setTimeout(updateLens, 120);
  }
  /** 选中一种构件时，画面里每个能放的格都算一遍得分（不必逐格悬停） */
  function updateLens() {
    const def = tool && tool !== 'remove' && !PAINT_TOOLS.has(tool.id) ? tool : null;
    if (!def || !lensOn) {
      if (view.lens) {
        view.lens = null;
        view.invalidate();
      }
      return;
    }
    const lens = new Map<string, number>();
    const c0 = ctx();
    const cells = view.viewCells();
    if (cells.length <= 9000) {
      for (const c of cells) {
        if (!map.canPlace(def, c).ok) continue;
        lens.set(hexKey(c), evaluate(map, c, def, c0).score);
      }
    }
    view.lens = lens;
    view.invalidate();
  }

  // ---------------------------------------------------------------- 拖动施工

  let paintBefore: ReturnType<PlanMap['snapshot']> | null = null;
  let paintPath: Hex[] = [];
  let paintCount = 0;
  function paintOne(h: Hex) {
    if (!tool) return;
    if (tool === 'remove') {
      if (map.remove(h)) paintCount++;
    } else if (map.place(tool, h).ok) paintCount++;
  }
  function paint(phase: 'start' | 'move' | 'end', hexes: Hex[]) {
    if (phase === 'start') {
      paintBefore = map.snapshot();
      paintPath = [];
      paintCount = 0;
    }
    for (const h of hexes) {
      paintPath.push(h);
      paintOne(h);
    }
    if (phase !== 'end') {
      if (hexes.length) {
        if (paintCount) sound.tick();
        view.invalidate();
      }
      return;
    }
    // 首尾相近（三格以内）而城墙还没合围：自动补上缺口
    if (tool !== 'remove' && tool?.id === 'wall' && paintPath.length > 6 && !map.walled) {
      const a = paintPath[0], b = paintPath[paintPath.length - 1];
      const d = PlanMap.dist(a, b);
      if (d >= 2 && d <= 3) for (const h of hexLine(b, a).slice(1, -1)) paintOne(h);
      if (map.walled) toast(`城墙合围，城内 ${map.inside().size} 格`);
    }
    if (paintCount && paintBefore) {
      history.push(paintBefore);
      sound.click();
      changed();
      if (tool !== 'remove' && tool?.id === 'qu' && paintPath.some((h) => map.at(h)?.id === 'qu' && !map.isWet(h))) {
        toast('此段渠尚未通水：要接上江河、湖塘或有水的护城河');
      }
    } else if (paintBefore && tool && tool !== 'remove' && paintPath.length === 1) {
      toast(map.canPlace(tool, paintPath[0]).reason ?? '不能建在这里');
    }
    paintBefore = null;
  }

  function updateGhost() {
    if (!hoverHex || !tool) view.ghost = null;
    else if (tool === 'remove') view.ghost = { def: null, hex: hoverHex, ok: !!map.at(hoverHex) && !map.locked.has(`${hoverHex.q},${hoverHex.r}`) };
    else view.ghost = { def: tool, hex: hoverHex, ok: map.canPlace(tool, hoverHex).ok };
    view.invalidate();
  }

  /** 预测：假如放在这里，评价如何 */
  function predict(def: BuildingDef, h: Hex): Verdict | null {
    if (!map.canPlace(def, h).ok) return null;
    map.place(def, h);
    const v = evaluate(map, h, def, ctx());
    map.remove(h);
    return v;
  }

  function notesHtml(v: Verdict): string {
    return `<ul>${v.notes.map((n) => `<li class="${n.delta > 0 ? 'good' : n.delta < 0 ? 'bad' : ''}">${n.delta > 0 ? '＋' : n.delta < 0 ? '－' : '·'} ${n.text}</li>`).join('')}</ul>`;
  }

  function showTip() {
    if (!hoverHex) {
      tipEl.hidden = true;
      return;
    }
    const c = map.cell(hoverHex);
    if (!c) {
      tipEl.hidden = true;
      return;
    }
    const label = map.labels.get(`${c.q},${c.r}`);
    const terrain = `${label ? `${label} · ` : ''}${map.terrainName(c.terrain)}${c.elev > 5 ? ` · 高 ${Math.round(c.elev)} 米` : ''}`;
    let html = '';
    if (tool && tool !== 'remove') {
      const chk = map.canPlace(tool, hoverHex);
      if (!chk.ok) html = `<b>${tool.name}</b><em class="bad">${chk.reason}</em>`;
      else {
        const v = predict(tool, hoverHex)!;
        html = `<b>${tool.name}<span class="score">${v.score}</span></b><em>${v.where}</em>${notesHtml(v)}`;
      }
    } else {
      const b = map.at(hoverHex);
      if (b) {
        const v = evaluate(map, hoverHex, b, ctx());
        html = `<b>${b.name}<span class="score">${v.score}</span></b><em>${v.where}</em>${notesHtml(v)}`;
      }
    }
    tipEl.innerHTML = `${html}<small>${terrain}</small>`;
    const x = Math.min(hoverScreen[0] + 18, innerWidth - 300);
    const y = Math.min(hoverScreen[1] + 18, innerHeight - tipEl.offsetHeight - 70);
    tipEl.style.transform = `translate(${x}px, ${y}px)`;
    tipEl.hidden = false;
  }

  function placeAt(h: Hex, def: BuildingDef) {
    const before = map.snapshot();
    const res = map.place(def, h);
    if (!res.ok) {
      toast(res.reason ?? '不能建在这里');
      return;
    }
    history.push(before);
    sound.click();
    changed();
    void checkYili(h, def);
  }

  // ---------------------------------------------------------------- 议礼

  /** 已放下、触发了议礼却还没议的 */
  function pendingYili(): { ev: YiliEvent; hex: Hex | null }[] {
    const out: { ev: YiliEvent; hex: Hex | null }[] = [];
    const live = liveYili();
    for (const ev of yiliEvents) {
      if (finishTriggers(map, ev, session.yili?.oldWalls) && !alreadySettled(live, ev)) out.push({ ev, hex: null });
    }
    for (const b of map.buildings()) {
      for (const ev of yiliEvents) {
        if (placeTriggers(map, ev, b.hex, b.def.id) && !alreadySettled(live, ev, b.hex)) out.push({ ev, hex: b.hex });
      }
    }
    return out;
  }

  async function checkYili(h: Hex, def: BuildingDef) {
    if (yiliOpen) return;
    const live = liveYili();
    const ev = yiliEvents.find((e) => placeTriggers(map, e, h, def.id) && !alreadySettled(live, e, h));
    if (ev) await runYili(ev, h);
  }

  /** 开一场议礼；议定返回 true，搁置返回 false */
  async function runYili(ev: YiliEvent, h: Hex | null): Promise<boolean> {
    if (!session.yili) return false;
    yiliOpen = true;
    const before = view.highlight;
    const res = await showYili(root, ev, {
      unlocked: (c) => session.yili!.unlocked(c),
      exploreHref: session.yili.exploreHref,
      highlight: (on) => {
        if (on && ev.trigger.kind === 'place') {
          const cells = suburb(map, ev.trigger.ideal).all;
          view.highlight = new Set(cells.map(hexKey));
          if (cells.length) {
            const pts = cells.map((c) => hexToWorld(c, map.hexSize));
            view.focus([pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length], 16);
          }
        } else view.highlight = before;
        view.invalidate();
      },
    });
    yiliOpen = false;
    if (!res) {
      toast('此事暂且搁置，可在右侧「议礼」栏再议');
      refresh();
      return false;
    }
    yiliRecords = [...yiliRecords.filter((r) => r.id !== ev.id), { id: ev.id, choice: res, ...(h ? { hex: hexKey(h) } : {}) }];
    session.yili.save(yiliRecords);
    const opt = ev.options.find((o) => o.key === res);
    if (res === 'A' && opt?.effect.reputation) session.yili.onReputation?.(opt.effect.reputation, ev);
    changed();
    return true;
  }

  function yiliSummaries(): YiliSummary[] {
    return liveYili().flatMap((r) => {
      const ev = yiliEvents.find((e) => e.id === r.id);
      const opt = ev?.options.find((o) => o.key === r.choice);
      if (!ev || !opt) return [];
      return [{
        title: ev.title, choice: r.choice, label: opt.label,
        note: r.choice === 'A' ? ev.exemptNote ?? '有据，准予存案' : `考成修正 ${opt.effect.modifier ?? 0}`,
        chronicle: ev.chronicle?.[r.choice],
        reputation: r.choice === 'A' ? opt.effect.reputation : undefined,
      }];
    });
  }

  function removeAt(h: Hex) {
    const before = map.snapshot();
    if (!map.remove(h)) return;
    history.push(before);
    sound.tick();
    changed();
  }

  function changed() {
    refresh();
    session.onChange?.(map);
  }

  function refresh() {
    // 构件拆了，对应的议礼就作废（重放要重新议）
    const live = liveYili();
    if (live.length !== yiliRecords.length) {
      yiliRecords = live;
      session.yili?.save(live);
    }
    verdict = { ...evaluateCity(map, ctx()), yili: yiliSummaries() };
    const pending = session.yili ? pendingYili() : [];
    const recs = verdict.yili ?? [];
    $('.yili-rec').hidden = !recs.length && !pending.length;
    $('.yili-rec ul').innerHTML = [
      ...recs.map((y) => `<li class="${y.choice === 'A' ? '' : 'bad'}"><b>${y.title} · ${y.label}</b><em>${y.note}${y.reputation ? ` · 得「${y.reputation}」` : ''}</em></li>`),
      ...pending.map((p, i) => `<li class="bad"><b>${p.ev.title} · 待议</b><em>${p.hex ? '部臣有诘，尚未作答' : '考成之前，部臣将有一问'} <button class="reyi" data-i="${i}">再议</button></em></li>`),
    ].join('');
    root.querySelectorAll<HTMLButtonElement>('.yili-rec .reyi').forEach((b) =>
      b.addEventListener('click', () => {
        const p = pending[Number(b.dataset.i)];
        if (p && !yiliOpen) void runYili(p.ev, p.hex);
      }),
    );
    const built = verdict.buildings.some((b) => b.def.id !== 'wall');
    $('.grade b').textContent = built ? verdict.grade : '—';
    $('.grade span').textContent = built ? `风水总评 ${verdict.total}` : '尚未营建';
    $('.patterns ul').innerHTML = verdict.patterns.map((p) => `<li class="${p.ok ? 'ok' : ''}"><i>${p.ok ? '✓' : '·'}</i><b>${p.name}</b><span>${p.text}</span></li>`).join('');
    const worst = verdict.buildings
      .filter((b) => b.def.id !== 'wall' && b.verdict.score < 65)
      .sort((a, b) => a.verdict.score - b.verdict.score)
      .slice(0, 4);
    $('.worst').hidden = !worst.length;
    $('.worst ul').innerHTML = worst
      .map((b) => `<li><b>${b.def.name}</b><span>${b.verdict.where} · ${b.verdict.score} 分</span><em>${b.verdict.notes.find((n) => n.delta < 0)?.text ?? ''}</em></li>`)
      .join('');
    if (session.goals) {
      const goals = session.goals(map, verdict);
      $('.goals').hidden = false;
      $('.goals ul').innerHTML = goals.map((g) => `<li class="${g.done ? 'ok' : ''}"><i>${g.done ? '✓' : '○'}</i><span>${g.text}${!g.done && g.hint ? `<small>${g.hint}</small>` : ''}</span></li>`).join('');
    }
    const fin = $<HTMLButtonElement>('.finish');
    fin.disabled = session.canFinish ? !session.canFinish(map, verdict) : false;
    renderItems();
    updateGhost();
    updateLens();
    view.invalidate();
  }

  let toastTimer = 0;
  function toast(text: string) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2200);
  }

  function undo() {
    const prev = history.pop();
    if (!prev) return toast('没有可撤销的改动');
    map.restore(prev);
    changed();
  }

  // 事件
  $('.home').addEventListener('click', () => session.onHome());
  const judge = $('.plan-judge');
  if (innerWidth <= 960 || !session.goals) judge.classList.add('folded');
  $('.grade').addEventListener('click', () => judge.classList.toggle('folded'));
  root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      group = b.dataset.g as typeof group;
      root.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      renderItems();
    }),
  );
  itemsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
    if (b) selectTool(BUILDING_BY_ID.get(b.dataset.id!)!);
  });
  $('.tool-remove').addEventListener('click', () => selectTool('remove'));
  $('.compass').addEventListener('click', toggleCompass);
  const toggleLens = () => {
    lensOn = !lensOn;
    $('.lens').classList.toggle('on', lensOn);
    updateLens();
    updateHint();
  };
  $('.lens').addEventListener('click', toggleLens);
  $('.undo').addEventListener('click', undo);
  root.querySelectorAll<HTMLButtonElement>('.extra').forEach((b) =>
    b.addEventListener('click', () => session.extraButtons![Number(b.dataset.i)].onClick(ui)),
  );
  $('.finish').addEventListener('click', async () => {
    // 考成之前，未议之礼先议
    for (const p of pendingYili()) if (!(await runYili(p.ev, p.hex))) return;
    if (session.canFinish && !session.canFinish(map, verdict)) return;
    session.onFinish(map, verdict, ui);
  });
  function toggleCompass() {
    view.showCompass = !view.showCompass;
    $('.compass').classList.toggle('on', view.showCompass);
    view.invalidate();
  }
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === 'Escape') selectTool(null);
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undo();
    }
    if (e.key === 'c' || e.key === 'C') toggleCompass();
    if (e.key === 'v' || e.key === 'V') toggleLens();
  });

  const ui: PlanUI = { view, refresh, toast, root };
  refresh();
  if (session.intro) openModal(root, session.intro, '开始营建');
  // 调试
  Object.assign(window, {
    __plan: map, __planView: view, __planUI: ui,
    /** 在某格放构件（走与点击相同的流程，含议礼判定），返回是否放下 */
    __planPlace: (id: string, q: number, r: number) => {
      const def = BUILDING_BY_ID.get(id);
      if (!def || !map.canPlace(def, { q, r }).ok) return false;
      placeAt({ q, r }, def);
      return true;
    },
  });
  return ui;
}

/** 通用弹窗：内容 HTML + 若干按钮，返回点了哪个按钮 */
export function openModal(root: HTMLElement, html: string, ...buttons: string[]): Promise<number> {
  const modal = root.querySelector<HTMLElement>('.plan-modal')!;
  const sheet = modal.querySelector<HTMLElement>('.sheet')!;
  sheet.innerHTML = `${html}<div class="actions">${buttons.map((b, i) => `<button data-i="${i}" class="${i ? '' : 'primary'}">${b}</button>`).join('')}</div>`;
  modal.hidden = false;
  return new Promise((resolve) => {
    sheet.querySelectorAll<HTMLButtonElement>('.actions button').forEach((b) =>
      b.addEventListener('click', () => {
        modal.hidden = true;
        resolve(Number(b.dataset.i));
      }),
    );
  });
}
