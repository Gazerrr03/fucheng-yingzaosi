// 议礼判定的断言：用真实的襄阳营建课地图，检查社稷坛放在不同位置时是否触发。
// 运行：node tools/check_yili.mjs
import { readFileSync } from 'node:fs';
import { BUILDING_BY_ID } from '../../src/plan/buildings';
import { evaluate, evaluateCity } from '../../src/plan/fengshui';
import { composeChronicle } from '../../src/plan/chronicle';
import { PlanMap } from '../../src/plan/planMap';
import { finishTriggers, historicWallShare, idealBlocked, placeTriggers, suburb, yiliOutcome, liveRecords, type YiliFile } from '../../src/plan/yili';
import { oldWallKeys } from '../../src/plan/lessons';

const ROOT = new URL('../../public/data/', import.meta.url);
const load = (p: string) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};

const lv = load('xiangyang.json');
const map = new PlanMap(PlanMap.fromLevel('xiangyang', lv.name, lv.terrain, { hexAcross: lv.grid.hexAcross, keepWalls: true, lockWalls: true, terrainNames: lv.terrainNames }));
const yili: YiliFile = load('yili/xiangyang.json');
const ev = yili.events[0];
const sheji = BUILDING_BY_ID.get('sheji')!;

const nw = suburb(map, 'NW');
check('襄阳城已合围', map.walled);
check('西北近郊被汉江阻断', idealBlocked(map, 'NW'), `近郊 ${nw.all.length} 格，可建陆地 ${nw.land.length} 格`);
for (const d of ['W', 'S', 'SE', 'N'] as const) {
  const s = suburb(map, d);
  console.log(`  · ${d} 近郊 ${s.all.length} 格，可建陆地 ${s.land.length} 格`);
}

/** 找一格：某方位城外近郊、可放社稷坛 */
const spot = (dir: string) => {
  const inside = map.inside();
  for (const [key, c] of map.cells) {
    if (inside.has(key)) continue;
    const d = map.dirOf(c);
    if (d.dir === dir && d.ratio > 1.0 && d.ratio < 1.6 && map.canPlace(sheji, c).ok) return c;
  }
  return null;
};
const w = spot('W');
check('西门外有可放社稷坛的格', !!w);
if (w) check('社稷坛放西门外 → 触发议礼', placeTriggers(map, ev, w, 'sheji'));
const se = spot('SE');
if (se) check('社稷坛放东南 → 不触发（明显违制，照常扣分）', !placeTriggers(map, ev, se, 'sheji'));
const inner = [...map.cells.values()].find((c) => map.inside().has(`${c.q},${c.r}`) && map.dirOf(c).dir === 'W' && map.canPlace(sheji, c).ok);
if (inner) check('社稷坛放城内西侧 → 不触发（坛须在城外）', !placeTriggers(map, ev, inner, 'sheji'));
check('别的构件不触发', !w || !placeTriggers(map, ev, w, 'shanchuan'));

// 结果推算：A 豁免 + 声望；C 修正项；坛拆掉后记录失效
if (w) {
  const key = `${w.q},${w.r}`;
  const a = yiliOutcome([{ id: ev.id, choice: 'A', hex: key }], yili.events);
  check('选 A → 社稷坛豁免、得「通晓礼制」', a.exempt.has('sheji') && a.reputation.includes('通晓礼制'));
  const c = yiliOutcome([{ id: ev.id, choice: 'C', hex: key }], yili.events);
  check('选 C → 修正项 −5', c.modifiers.length === 1 && c.modifiers[0].delta === -5);
  check('坛不在原格 → 记录失效', liveRecords(map, [{ id: ev.id, choice: 'A', hex: key }], yili.events).length === 0);
  map.place(sheji, w);
  check('坛在原格 → 记录有效', liveRecords(map, [{ id: ev.id, choice: 'A', hex: key }], yili.events).length === 1);
  const plain = evaluate(map, w, sheji).score;
  const exempt = evaluate(map, w, sheji, { exempt: a.exempt }).score;
  check('未议礼：西门外的社稷坛不到 80 分（课程目标未达）', plain < 80, `${plain} 分`);
  check('议礼引方志后：豁免，≥ 80 分', exempt >= 80, `${exempt} 分`);
  const t0 = evaluateCity(map).total;
  const t1 = evaluateCity(map, { modifiers: c.modifiers }).total;
  check('强辩：总分扣 5', t0 - t1 === 5, `${t0} → ${t1}`);
  for (const choice of ['A', 'C'] as const) {
    const verdict = { ...evaluateCity(map), yili: [{ title: ev.title, choice, label: '', note: '', chronicle: ev.chronicle?.[choice] }] };
    const entry = composeChronicle({ map, verdict, mode: 'lesson', profile: { name: '某', office: '知府' } as never, revision: 1 });
    check(`史书营建记写入议礼（${choice}）`, entry.body.some((p) => p.includes(ev.chronicle![choice]!)));
  }
}

// 考成前的议礼：荆州（锁定的旧城墙）、保定（照旧城墙走向自筑）
for (const city of ['jingzhou', 'baoding']) {
  const lv2 = load(`${city}.json`);
  const keep = city === 'jingzhou';
  const m = new PlanMap(PlanMap.fromLevel(city, lv2.name, lv2.terrain, { hexAcross: lv2.grid.hexAcross, keepWalls: keep, lockWalls: true, terrainNames: lv2.terrainNames }));
  const ev2 = (load(`yili/${city}.json`) as YiliFile).events[0];
  const old = keep ? new Set<string>() : oldWallKeys(lv2.terrain.rows, lv2.terrain.qMin, lv2.terrain.rMin);
  if (!keep) {
    check('保定：未筑城不触发', !finishTriggers(m, ev2, old));
    for (const k of old) { const [q, r] = k.split(',').map(Number); m.place(BUILDING_BY_ID.get('wall')!, { q, r }); }
  }
  check(`${lv2.name}：城形同于史实 → 考成前触发`, finishTriggers(m, ev2, old), `沿用旧址 ${(historicWallShare(m, old) * 100).toFixed(0)}%`);
  const card = ev2.options[0].requires!;
  check(`${lv2.name}：方志卡 ${card} 挂在某个地点上`, lv2.sites.some((s: { cards: string[] }) => s.cards.includes(card)));
}

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
