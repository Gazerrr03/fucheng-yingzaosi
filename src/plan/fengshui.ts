// 方位风水评价：单座构件按方位、地形、相互关系打分；全城再看整体格局。
// 规则表见 docs/玩法需求_v2.md 第 3 节。所有评语都写成可读的讲解，兼作科普。

import { hexKey, hexToWorld, neighbors, type Hex } from '../scene/hex';
import { DIR_GUA, DIR_NAME, type BuildingDef, type Dir } from './buildings';
import { PlanMap } from './planMap';

export interface Note {
  /** 正为加分，负为减分 */
  delta: number;
  text: string;
}

export interface Verdict {
  score: number;
  notes: Note[];
  /** 方位描述，例如「城东南（巽）」 */
  where: string;
}

export interface PatternItem {
  id: string;
  name: string;
  ok: boolean;
  text: string;
  bonus: number;
}

export type Grade = '上上' | '上中' | '中上' | '中' | '下';

export interface CityVerdict {
  buildings: { hex: Hex; def: BuildingDef; verdict: Verdict }[];
  patterns: PatternItem[];
  /** 考成修正项（议礼强辩等） */
  modifiers: { name: string; delta: number }[];
  /** 本次营建里议过的礼（由营建界面填入） */
  yili?: YiliSummary[];
  total: number;
  grade: Grade;
  setting: Setting;
}

export interface YiliSummary {
  title: string;
  choice: 'A' | 'C';
  /** 所选一项，例如「引方志为证」 */
  label: string;
  /** 豁免评语或修正说明 */
  note: string;
  /** 营建记里的一句 */
  chronicle?: string;
  reputation?: string;
}

/** 评价时的附加条件：议礼得来的地形豁免、修正项。 */
export interface EvalContext {
  /** 构件 id → 豁免评语（例如社稷坛「地形豁免 · 有据：……」） */
  exempt?: Map<string, string>;
  modifiers?: { name: string; delta: number }[];
}

export interface Setting {
  /** 山在城的哪些方位（按格数多少排序） */
  mountains: Dir[];
  waters: Dir[];
  mountainName?: string;
  waterName?: string;
}

const NEAR: Record<Dir, Dir[]> = {
  N: ['NW', 'NE'], NE: ['N', 'E'], E: ['NE', 'SE'], SE: ['E', 'S'],
  S: ['SE', 'SW'], SW: ['S', 'W'], W: ['SW', 'NW'], NW: ['W', 'N'],
};

export function whereText(map: PlanMap, h: Hex): string {
  const { dir } = map.dirOf(h);
  if (dir === 'C') return '城中';
  return `城${DIR_NAME[dir]}（${DIR_GUA[dir]}）`;
}

/** 方位偏好：正位 +best，邻位 +best/2，对位 -best */
function dirPref(map: PlanMap, h: Hex, want: Dir, best: number, label: string, notes: Note[]): void {
  const { dir } = map.dirOf(h);
  const opposite: Dir = (['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'] as Dir[])[(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as Dir[]).indexOf(want)];
  if (dir === want) notes.push({ delta: best, text: `居城${DIR_NAME[want]}${DIR_GUA[want]}位，${label}` });
  else if (dir !== 'C' && NEAR[want].includes(dir)) notes.push({ delta: Math.round(best / 2), text: `在城${DIR_NAME[dir]}，近于${DIR_NAME[want]}，大体合制` });
  else if (dir === opposite) notes.push({ delta: -best, text: `宜在城${DIR_NAME[want]}，今在城${DIR_NAME[dir]}，方位相悖` });
  else notes.push({ delta: -Math.round(best / 3), text: `宜在城${DIR_NAME[want]}，今在${dir === 'C' ? '城中' : `城${DIR_NAME[dir]}`}` });
}

function nearest(map: PlanMap, h: Hex, id: string): number {
  let best = Infinity;
  for (const b of map.buildings()) if (b.def.id === id) best = Math.min(best, PlanMap.dist(h, b.hex));
  return best;
}

function nearWaterWithin(map: PlanMap, h: Hex, n: number): boolean {
  for (let dq = -n; dq <= n; dq++) {
    for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
      if (map.isWater({ q: h.q + dq, r: h.r + dr })) return true;
    }
  }
  return false;
}

function avgNeighborElev(map: PlanMap, h: Hex): number {
  const es = neighbors(h).map((n) => map.cell(n)?.elev).filter((e): e is number => e !== undefined);
  return es.length ? es.reduce((a, b) => a + b, 0) / es.length : 0;
}

export function evaluate(map: PlanMap, h: Hex, def: BuildingDef, ctx: EvalContext = {}): Verdict {
  const notes: Note[] = [];
  const key = hexKey(h);
  const walled = map.walled;
  const inside = map.inside().has(key);
  const { dir, ratio } = map.dirOf(h);
  const cell = map.cell(h);
  const elev = cell?.elev ?? 0;
  const nb = neighbors(h);
  const wantInside = (label: string) => {
    if (!walled) notes.push({ delta: -5, text: '城墙尚未合围，城内城外未分' });
    else if (inside) notes.push({ delta: 10, text: `在城内，${label}` });
    else notes.push({ delta: -20, text: `${label}，却建在城外` });
  };
  const wantOutside = (label: string) => {
    if (!walled) return;
    if (!inside && ratio < 2.2) notes.push({ delta: 10, text: `在城外近郊，${label}` });
    else if (inside) notes.push({ delta: -15, text: '坛壝例在城外郊野，不宜入城' });
    else notes.push({ delta: -5, text: '离城太远，官员致祭不便' });
  };
  /** 坛壝方位：议礼得了地形豁免的，按合制计分，评语写明理由 */
  const altarDir = (want: Dir) => {
    const note = ctx.exempt?.get(def.id);
    if (note && !inside) notes.push({ delta: 25, text: note });
    else dirPref(map, h, want, 25, '合洪武坛壝之制', notes);
  };

  switch (def.id) {
    case 'fushu':
      wantInside('一府之治所');
      if (dir === 'C') notes.push({ delta: 20, text: '居城之中，统摄四方' });
      else if (['N', 'NE', 'NW'].includes(dir) && ratio < 0.7) notes.push({ delta: 20, text: '居城中偏北，坐北朝南，合明代府署常制' });
      else if (['S', 'SE', 'SW'].includes(dir)) notes.push({ delta: -15, text: '府署宜坐北朝南，偏居城南则失其位' });
      else notes.push({ delta: 0, text: `偏在城${DIR_NAME[dir]}` });
      if (elev >= avgNeighborElev(map, h) - 1) notes.push({ delta: 5, text: '地势高敞' });
      if (nb.some((n) => map.isMountain(n)) && !['S', 'SE', 'SW'].includes(dir)) notes.push({ delta: 5, text: '背倚山岗，有靠' });
      break;
    case 'xianshu':
      wantInside('附郭县治');
      if (nearest(map, h, 'fushu') <= 4) notes.push({ delta: 15, text: '与府署相近，府县同城相辅' });
      break;
    case 'gulou':
      wantInside('为全城报时');
      if (dir === 'C') notes.push({ delta: 20, text: '居城中，钟鼓之声四达' });
      if (nearest(map, h, 'fushu') <= 3) notes.push({ delta: 10, text: '立于府署之前' });
      break;
    case 'xuegong':
      wantInside('学宫例在城内');
      dirPref(map, h, 'SE', 25, '东南巽方主文运，方志多记「学宫在治东南」', notes);
      if (nearWaterWithin(map, h, 1)) notes.push({ delta: 10, text: '近水，可引为泮池' });
      break;
    case 'chenghuang':
      wantInside('城隍守一城');
      if (nearest(map, h, 'fushu') <= 5) notes.push({ delta: 15, text: '与府署相望，一阴一阳相表里' });
      break;
    case 'sheji':
      altarDir('NW');
      wantOutside('合坛壝之制');
      break;
    case 'shanchuan':
      altarDir('S');
      wantOutside('合坛壝之制');
      break;
    case 'litan':
      altarDir('N');
      wantOutside('合坛壝之制');
      break;
    case 'shuyuan':
      if (['SE', 'E', 'S'].includes(dir)) notes.push({ delta: 10, text: '在城之东南一带，文气所钟' });
      if (nearWaterWithin(map, h, 2) || nb.some((n) => map.isMountain(n))) notes.push({ delta: 15, text: '依山近水，清幽宜于讲学' });
      if (nearest(map, h, 'xuegong') <= 5) notes.push({ delta: 5, text: '与学宫相近' });
      break;
    case 'kuixing':
      dirPref(map, h, 'SE', 20, '巽方文峰', notes);
      if (elev > avgNeighborElev(map, h) + 3 || map.isMountain(h)) notes.push({ delta: 15, text: '据高处，文峰挺秀' });
      if (nearest(map, h, 'xuegong') <= 4) notes.push({ delta: 10, text: '与学宫相望' });
      break;
    case 'louge':
      if (map.isMountain(h) || elev > avgNeighborElev(map, h) + 3) notes.push({ delta: 20, text: '据山头高处，登临可望全城' });
      else notes.push({ delta: -5, text: '平地起楼，登临所见有限' });
      if (nearWaterWithin(map, h, 2)) notes.push({ delta: 20, text: '临江水，可观大江东去' });
      break;
    case 'shisi': {
      const g = nearest(map, h, 'gate'), m = nearest(map, h, 'matou');
      if (g <= 2) notes.push({ delta: 20, text: '近城门，四乡货物出入便利' });
      if (m <= 2) notes.push({ delta: 20, text: '近码头，舟楫百货就近交易' });
      if (g > 2 && m > 2) notes.push({ delta: -10, text: '离城门、码头都远，商旅不便' });
      const f = [...map.buildings()].find((b) => b.def.id === 'fushu');
      if (f) {
        const [, fy] = hexToWorld(f.hex, map.hexSize);
        const [, y] = hexToWorld(h, map.hexSize);
        if (y > fy && PlanMap.dist(h, f.hex) <= 5) notes.push({ delta: 5, text: '在府署之后，暗合《考工记》「面朝后市」' });
      }
      break;
    }
    case 'minju': {
      if (map.isMountain(h) && cell?.terrain === 'S') notes.push({ delta: -15, text: '陡山之上，起屋汲水皆难' });
      if (nb.some((n) => map.cell(n)?.terrain === 'R')) notes.push({ delta: -10, text: '紧贴大江，汛期易涝' });
      const peers = nb.filter((n) => map.at(n)?.id === 'minju').length;
      if (peers >= 2) notes.push({ delta: 10, text: '坊巷连片' });
      if (walled && inside) notes.push({ delta: 5, text: '居于城内，有城可守' });
      break;
    }
    case 'wall':
      if (walled && nb.some((n) => map.inside().has(hexKey(n)))) notes.push({ delta: 10, text: '城墙已合围' });
      else if (!walled) notes.push({ delta: -10, text: '城墙尚未闭合' });
      if (map.isMountain(h)) notes.push({ delta: 10, text: '城随山势，据险而筑' });
      if (nb.some((n) => map.isNaturalWater(n))) notes.push({ delta: 10, text: '濒水筑城，以水为池' });
      break;
    case 'gate': {
      if (dir !== 'C' && ['N', 'E', 'S', 'W'].includes(dir)) notes.push({ delta: 15, text: `开于城${DIR_NAME[dir]}，正对四方` });
      const outside = nb.filter((n) => map.cell(n) && !map.inside().has(hexKey(n)) && !map.isWallish(n));
      if (outside.length && outside.every((n) => map.isWater(n))) notes.push({ delta: -10, text: '门外皆水，出入须舟' });
      if (nb.some((n) => map.at(n)?.id === 'wengcheng')) notes.push({ delta: 10, text: '门外有瓮城护卫' });
      break;
    }
    case 'wengcheng':
      notes.push({ delta: 20, text: '护住城门，敌入瓮中' });
      if (!nearWaterWithin(map, h, 2)) notes.push({ delta: 10, text: '此面无水可守，瓮城尤为要紧' });
      break;
    case 'jiaolou':
      if (map.isCorner(h)) notes.push({ delta: 20, text: '建于城墙转角，两面瞭望' });
      else notes.push({ delta: -10, text: '角楼宜在城墙转角' });
      break;
    case 'ditai':
      if (!nearWaterWithin(map, h, 2)) notes.push({ delta: 25, text: '此面无水为险，敌台补陆路之防' });
      else notes.push({ delta: 0, text: '临水一面本有天险，敌台作用有限' });
      break;
    case 'matou':
      if (nb.some((n) => map.cell(n)?.terrain === 'R')) notes.push({ delta: 20, text: '临大江，舟楫可达' });
      if (nearest(map, h, 'gate') <= 3 || nearest(map, h, 'shuimen') <= 3) notes.push({ delta: 10, text: '近城门，货物转运入城便捷' });
      if (nearest(map, h, 'shisi') <= 2) notes.push({ delta: 10, text: '市肆相依' });
      break;
    case 'shuimen': {
      const waterSides = nb.filter((n) => map.isWater(n)).length;
      notes.push({ delta: waterSides >= 1 ? 20 : -10, text: waterSides >= 1 ? '引水入城，兼通舟楫' : '水门不临水' });
      break;
    }
    case 'moat':
      notes.push({ delta: 15, text: '城外有池，城池相依' });
      if (nb.some((n) => map.isNaturalWater(n) || (map.at(n)?.id === 'moat' && n !== h))) notes.push({ delta: 10, text: '濠水相连成环' });
      break;
    case 'qu':
      if (map.isWet(h)) notes.push({ delta: 10, text: '渠通活水' });
      else notes.push({ delta: -10, text: '干渠一段，尚未接上江河湖塘' });
      break;
  }

  const score = Math.max(0, Math.min(100, 55 + notes.reduce((a, n) => a + n.delta, 0)));
  return { score, notes, where: whereText(map, h) };
}

/** 山水形势：统计城外两倍半径内山、水分布在哪些方位。 */
export function describeSetting(map: PlanMap): Setting {
  const center = map.center();
  const R = map.radius() * 2.5;
  const m = new Map<Dir, number>(), w = new Map<Dir, number>();
  const inside = map.inside();
  for (const [k, c] of map.cells) {
    if (inside.has(k)) continue;
    const [x, y] = hexToWorld(c, map.hexSize);
    if (Math.hypot(x - center[0], y - center[1]) > R) continue;
    const { dir } = map.dirOf(c);
    if (dir === 'C') continue;
    if (c.terrain === 'S' || c.terrain === 'H') m.set(dir, (m.get(dir) ?? 0) + (c.terrain === 'S' ? 1 : 0.5));
    if (c.terrain === 'R' || c.terrain === 'W') w.set(dir, (w.get(dir) ?? 0) + (c.terrain === 'R' ? 1 : 0.5));
  }
  const top = (mp: Map<Dir, number>) => {
    const total = [...mp.values()].reduce((a, b) => a + b, 0);
    return [...mp].filter(([, v]) => v >= Math.max(2, total * 0.15)).sort((a, b) => b[1] - a[1]).map(([d]) => d);
  };
  const names = map.data.terrainNames ?? {};
  return { mountains: top(m), waters: top(w), mountainName: names.S, waterName: names.R };
}

export function evaluateCity(map: PlanMap, ctx: EvalContext = {}): CityVerdict {
  const buildings = [...map.buildings()].map((b) => ({ hex: b.hex, def: b.def, verdict: evaluate(map, b.hex, b.def, ctx) }));
  const setting = describeSetting(map);
  const patterns: PatternItem[] = [];
  const has = (id: string) => buildings.some((b) => b.def.id === id);
  const wallCells = [...map.buildings()].filter((b) => b.def.wallish);

  patterns.push({
    id: 'closed', name: '城垣合围', ok: map.walled, bonus: 8,
    text: map.walled ? `城墙合围，周回约 ${zhouhuiLi(map, wallCells.length)} 里` : '城墙尚未闭合，不成其为城',
  });
  const gateDirs = new Set(buildings.filter((b) => b.def.id === 'gate').map((b) => map.dirOf(b.hex).dir));
  const four = (['N', 'E', 'S', 'W'] as Dir[]).filter((d) => gateDirs.has(d));
  patterns.push({
    id: 'gates', name: '四门通达', ok: four.length === 4, bonus: 5,
    text: four.length === 4 ? '东西南北四门俱全' : `已开 ${[...gateDirs].filter((d) => d !== 'C').map((d) => DIR_NAME[d as Dir]).join('、') || '无'}门`,
  });
  const backMountain = setting.mountains.some((d) => ['N', 'NW', 'NE'].includes(d));
  const faceWater = setting.waters.some((d) => ['S', 'SE', 'SW', 'E'].includes(d));
  const anyMS = setting.mountains.length > 0 && setting.waters.length > 0;
  patterns.push({
    id: 'shanshui', name: '背山面水', ok: backMountain && faceWater, bonus: backMountain && faceWater ? 6 : anyMS ? 3 : 0,
    text: backMountain && faceWater ? '北有山可倚，南有水环抱' : anyMS ? `山在城${DIR_NAME[setting.mountains[0]]}，水在城${DIR_NAME[setting.waters[0]]}，依山傍水而不拘常格` : '四望平旷，无山水可依',
  });
  const wallWithWater = wallCells.filter((b) => neighbors(b.hex).some((n) => map.isWater(n))).length;
  const moatOk = wallCells.length > 0 && wallWithWater / wallCells.length >= 0.7;
  patterns.push({
    id: 'moat', name: '城池相依', ok: moatOk, bonus: 5,
    text: wallCells.length ? `城墙临水者十之${Math.round((wallWithWater / wallCells.length) * 10)}` : '尚无城墙',
  });
  const altars = ['sheji', 'shanchuan', 'litan'].filter(has);
  const altarsOk = altars.length === 3 && altars.every((id) => buildings.find((b) => b.def.id === id)!.verdict.score >= 70);
  patterns.push({
    id: 'altars', name: '三坛合制', ok: altarsOk, bonus: 6,
    text: altarsOk ? (ctx.exempt?.has('sheji') ? '社稷坛因地形移置（有据）、山川坛在南、厉坛在北，合洪武之制' : '社稷坛在西北、山川坛在南、厉坛在北，合洪武之制') : `已设坛 ${altars.length} / 3，或方位未合`,
  });

  const weight = (d: BuildingDef) => (d.id === 'wall' || d.id === 'moat' || d.id === 'qu' ? 0 : d.id === 'minju' ? 0.3 : 1);
  let sw = 0, ss = 0;
  for (const b of buildings) {
    const wgt = weight(b.def);
    sw += wgt;
    ss += wgt * b.verdict.score;
  }
  const avg = sw ? ss / sw : 0;
  const bonus = patterns.reduce((a, p) => a + (p.ok ? p.bonus : p.id === 'shanshui' ? p.bonus : 0), 0);
  const modifiers = ctx.modifiers ?? [];
  const total = Math.max(0, Math.round(Math.min(100, avg * 0.7 + bonus) + modifiers.reduce((a, m) => a + m.delta, 0)));
  return { buildings, patterns, modifiers, total, grade: gradeOf(total), setting };
}

export function gradeOf(total: number): Grade {
  return total >= 88 ? '上上' : total >= 78 ? '上中' : total >= 66 ? '中上' : total >= 50 ? '中' : '下';
}

/** 城墙周回（明里，约 576 米） */
export function zhouhuiLi(map: PlanMap, wallCount: number): string {
  const li = (wallCount * map.data.hexAcross) / 576;
  return li >= 1 ? li.toFixed(1).replace(/\.0$/, '') : li.toFixed(1);
}
