// 择址「形胜」评分：在天下舆图上选府城城址时，按临水、背山、平野、通衢四项打分（满分 100）。
// 思路同文明 6 开拓者透镜：不用逐格试，选址时全图直接标出好坏。
// 依据：明代府城多「依山傍水」——近水以通漕运、给城濠，背山以藏风、为屏障，沃野以供赋税。

import type { Hex } from '../scene/hex';
import { WORLD_TERRAIN, WorldMap, type WorldCell } from './worldMap';

export interface SiteFactor {
  name: '临水' | '背山' | '平野' | '通衢' | '地利';
  score: number;
  max: number;
  text: string;
}

export interface SiteVerdict {
  ok: boolean;
  /** 不能建时的原因 */
  reason?: string;
  total: number;
  grade: '上上' | '上' | '中' | '下';
  factors: SiteFactor[];
}

const RIVER_NAME: Record<number, string> = { 0: '运河', 1: '大江', 2: '大河', 3: '河', 4: '小河' };

export function gradeOf(total: number): SiteVerdict['grade'] {
  return total >= 80 ? '上上' : total >= 65 ? '上' : total >= 48 ? '中' : '下';
}

/** 北面（r 更大）与西面的邻格权重更高：背山宜在北、西 */
function backWeight(c: Hex, n: Hex): number {
  const dr = n.r - c.r, dq = n.q - c.q;
  const north = dr > 0 ? 1 : dr < 0 ? -1 : 0;
  const west = dq + dr / 2 < 0 ? 1 : 0;
  return 1 + 0.35 * north + 0.25 * west;
}

export function evaluateSite(map: WorldMap, h: Hex, opts: { taken?: Hex[] } = {}): SiteVerdict {
  const c = map.cell(h);
  const bad = (reason: string): SiteVerdict => ({ ok: false, reason, total: 0, grade: '下', factors: [] });
  if (!c) return bad('图外');
  if (map.isWater(c)) return bad('水面不能筑城');
  if (c.t === 'S' || c.t === 'X') return bad('山势陡峻，不能筑城');
  if (!c.domain) return bad('塞外之地，不在两京十三司之内');
  for (const t of opts.taken ?? []) {
    const d = WorldMap.dist(t, h);
    if (d > 0 && d <= 2) return bad('离已建的府城太近（须隔两格以上）');
  }

  const near1 = map.neighbors(c);
  const near2 = map.ring(c, 2);
  const factors: SiteFactor[] = [];

  // 临水
  let water = 0, wtext = '四望无水，难以开濠通漕';
  if (c.river !== undefined) {
    water = [22, 30, 24, 18, 14][c.river];
    wtext = `${c.riverNames[0]}穿境而过（${RIVER_NAME[c.river]}）`;
  } else {
    const rv = near1.filter((n) => n.river !== undefined).sort((a, b) => (a.river || 9) - (b.river || 9))[0];
    const lake = near1.find((n) => n.t === 'W');
    const sea = near1.find((n) => n.t === 'Q');
    if (rv) {
      water = rv.river === 1 ? 22 : rv.river === 0 ? 18 : 15;
      wtext = `濒临${rv.riverNames[0]}`;
    } else if (lake) {
      water = 16;
      wtext = '滨湖';
    } else if (sea) {
      water = 13;
      wtext = '滨海，可通海运，然多潮患';
    } else if (near2.some((n) => n.river !== undefined || n.t === 'W')) {
      water = 6;
      wtext = '近处有水，须引渠';
    }
  }
  factors.push({ name: '临水', score: water, max: 30, text: wtext });

  // 背山
  let back = 0;
  let rough1 = 0;
  for (const n of near2) {
    const k = n.t === 'S' || n.t === 'X' ? 1 : n.t === 'H' ? 0.6 : 0;
    if (!k) continue;
    const ring1 = WorldMap.dist(c, n) === 1;
    if (ring1) rough1++;
    back += k * backWeight(c, n) * (ring1 ? 3 : 1.8);
  }
  let backScore = Math.min(20, Math.round(back));
  let btext = backScore >= 14 ? '后有靠山，藏风聚气' : backScore >= 6 ? '近有冈阜可倚' : '一马平川，无险可凭';
  if (rough1 >= 5) {
    backScore = Math.max(0, backScore - 12);
    btext = '群山环抱，局促闭塞';
  }
  factors.push({ name: '背山', score: backScore, max: 20, text: btext });

  // 平野
  const arable = near2.reduce((s, n) => s + (n.t === 'F' ? (n.feature === 'm' ? 0.5 : 1) : n.t === 'C' ? 0.5 : n.t === 'H' ? 0.4 : 0), 0);
  const plain = Math.round((Math.min(arable, 15) / 15) * 30);
  factors.push({ name: '平野', score: plain, max: 30, text: plain >= 22 ? '沃野环绕，足供赋税' : plain >= 12 ? '田土尚可' : '可耕之地甚少' });

  // 通衢
  let link = 0;
  const notes: string[] = [];
  const names = new Set<string>([...c.riverNames, ...near1.flatMap((n) => n.riverNames)]);
  if (c.river === 0 || near1.some((n) => n.river === 0)) {
    link += 10;
    notes.push('临运河');
  }
  if (names.size >= 2) {
    link += 8;
    notes.push(`${[...names].slice(0, 2).join('、')}交汇`);
  }
  if (near1.some((n) => n.t === 'Q')) {
    link += 4;
    notes.push('可通海');
  }
  if (c.river === 1) link += 4;
  const cityNear = map.nearestCity(c);
  if (cityNear && cityNear.dist >= 2 && cityNear.dist <= 5) {
    link += 3;
    // 明里约 576 米
    notes.push(`距${cityNear.city.name}约 ${Math.round((cityNear.dist * map.data.hexKm) / 0.576 / 10) * 10} 里，往来便利`);
  }
  link = Math.min(20, link);
  factors.push({ name: '通衢', score: link, max: 20, text: notes.length ? notes.join('，') : '僻处一隅' });

  // 地利修正
  let adj = 0;
  const atext: string[] = [];
  if (c.t === 'H') { adj += 4; atext.push('地势高燥 +4'); }
  if (c.t === 'P') { adj -= 10; atext.push('高原苦寒 −10'); }
  if (c.t === 'D') { adj -= 15; atext.push('荒漠少水 −15'); }
  if (c.t === 'C') { adj -= 5; atext.push('草原宜牧不宜耕 −5'); }
  if (c.feature === 'm') { adj -= 8; atext.push('卑湿多泽 −8'); }
  if (c.elev > 2000) { adj -= 8; atext.push('地高 −8'); }
  if (adj) factors.push({ name: '地利', score: adj, max: 0, text: atext.join('；') });

  const total = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.score, 0)));
  return { ok: true, total, grade: gradeOf(total), factors };
}

/** 透镜颜色：低分赭红 → 中黄 → 高分青绿 */
export function lensColor(total: number, alpha = 0.55): string {
  const t = Math.max(0, Math.min(1, (total - 25) / 60));
  const stops = [[178, 64, 48], [214, 170, 70], [72, 140, 92]];
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const [a, b] = t < 0.5 ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const m = (i: number) => Math.round(a[i] + (b[i] - a[i]) * k);
  return `rgba(${m(0)},${m(1)},${m(2)},${alpha})`;
}

export function terrainLabel(c: WorldCell): string {
  const base = WORLD_TERRAIN[c.t].name;
  const f = c.feature === 'f' ? '·林' : c.feature === 'm' ? '·泽' : '';
  return base + f;
}
