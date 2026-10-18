// 经典模式营建课：每座府城教一种规划思路。顺序由浅入深：平原 → 临水 → 绕水 → 含山。
// 地形：保定、襄阳、荆州沿用 v1 关卡的地形格；武昌用 data/plan/wuchang.json（示意级）。

import { hexKey, neighbors, type Hex } from '../scene/hex';
import type { CityVerdict } from './fengshui';
import type { GoalState } from './planScreen';
import { PlanMap } from './planMap';

export interface Lesson {
  id: string;
  order: number;
  /** 第几课（中文） */
  ordinal: string;
  cityName: string;
  title: string;
  /** 总览里的一句话 */
  blurb: string;
  /** 地形来源：v1 关卡或营建地图 */
  source: { kind: 'level'; city: string } | { kind: 'plan'; map: string };
  /** 是否保留 v1 地形里的城墙（锁定） */
  keepWalls: boolean;
  /** 不保留城墙时，把旧城墙线作为「旧城基址」提示 */
  showOldWalls?: boolean;
  palette?: string[];
  /** 开场讲解（HTML 段落） */
  intro: string[];
  /** 学到什么（过关时回顾，也写进史书） */
  takeaway: string;
  goals(map: PlanMap, v: CityVerdict): GoalState[];
}

// ---------- 判定用的小工具 ----------

const all = (map: PlanMap, id: string) => [...map.buildings()].filter((b) => b.def.id === id);
const score = (v: CityVerdict, id: string) => Math.max(0, ...v.buildings.filter((b) => b.def.id === id).map((b) => b.verdict.score));
const pattern = (v: CityVerdict, id: string) => v.patterns.find((p) => p.id === id)?.ok ?? false;

function nearWater(map: PlanMap, h: Hex, n: number): boolean {
  for (let dq = -n; dq <= n; dq++) {
    for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
      if (map.isWater({ q: h.q + dq, r: h.r + dr })) return true;
    }
  }
  return false;
}

function gateDirs(map: PlanMap): Set<string> {
  return new Set(all(map, 'gate').map((g) => map.dirOf(g.hex).dir));
}

function fourGates(map: PlanMap): GoalState {
  const d = gateDirs(map);
  const have = ['N', 'E', 'S', 'W'].filter((x) => d.has(x));
  return { text: '东西南北四面各开一门', done: have.length === 4, hint: `已开 ${have.length} / 4；城门要建在城墙上` };
}

function walledWithin(map: PlanMap, minInside: number): GoalState {
  const n = map.inside().size;
  return {
    text: `筑城墙合围（城内不少于 ${minInside} 格）`,
    done: map.walled && n >= minInside,
    hint: map.walled ? `城内只有 ${n} 格，城太小` : '城墙要首尾相连成一圈，没有缺口',
  };
}

// ---------- 四课 ----------

export const LESSONS: Lesson[] = [
  {
    id: 'baoding', order: 1, ordinal: '一', cityName: '保定府', title: '平原上的堡垒',
    blurb: '无山可倚、无江可守，城防全靠人力。',
    source: { kind: 'level', city: 'baoding' }, keepWalls: false, showOldWalls: true,
    palette: ['wall', 'gate', 'wengcheng', 'jiaolou', 'ditai', 'moat', 'fushu', 'gulou', 'shisi', 'minju'],
    intro: [
      '保定地处冀中平原，西望太行，东临白洋淀水网，城下一马平川。没有天险可借，一座城能不能守住，全看城墙、城门、瓮城、角楼、护城河这一整套人工防御做得是否周全。',
      '明代保定府城周回约十二里，四门各有瓮城，城外绕以护城河。浅红色的格子是旧城墙的基址，可以照着修，也可以自己另起炉灶。',
      '这一课要学的是府城的「骨架」：先有城墙合围，才有城内城外；四门通四方；城心安放府署。',
    ],
    takeaway: '平原筑城，以人力补天险：城墙合围、四门瓮城、四角角楼、外绕濠池，府署居中以统四方。',
    goals: (map, v) => {
      const gates = all(map, 'gate');
      const guarded = gates.filter((g) => neighbors(g.hex).some((n) => map.at(n)?.id === 'wengcheng')).length;
      const corners = all(map, 'jiaolou').filter((j) => map.isCorner(j.hex)).length;
      return [
        walledWithin(map, 30),
        fourGates(map),
        { text: '每座城门外都有瓮城', done: gates.length >= 4 && guarded >= gates.length, hint: `已护 ${guarded} / ${gates.length} 门；瓮城建在城外、紧贴城门` },
        { text: '城墙转角建角楼四座', done: corners >= 4, hint: `已有 ${corners} / 4；角楼要建在城墙拐角处` },
        { text: '城池相依：七成以上城墙外临水', done: pattern(v, 'moat'), hint: '在城墙外侧修护城河' },
        { text: '府署居城中，坐北朝南（得分 ≥ 80）', done: score(v, 'fushu') >= 80, hint: '府署放在罗盘中宫或略偏北' },
      ];
    },
  },
  {
    id: 'xiangyang', order: 2, ordinal: '二', cityName: '襄阳府', title: '三面环水的防御性府城',
    blurb: '北临汉江、东西有濠，只有一面接陆。',
    source: { kind: 'level', city: 'xiangyang' }, keepWalls: true,
    intro: [
      '襄阳北临汉江，东、西两面都有宽阔的护城河，号称「铁打的襄阳」。三面环水，真正需要用力守的只有南面、西南面接着岘山的陆路。',
      '东晋时前秦攻襄阳，从西北角突破，刺史朱序之母韩夫人率城中妇女抢筑一段内城，守住了城池，后人称之为「夫人城」。这说明：防御要看清哪一面最薄弱。',
      '这一课城墙已经建好。把城门开出来，在陆路一面加敌台、瓮城，再在江边设码头、按方位出城设坛。',
    ],
    takeaway: '借水为险，审其薄弱：三面环水者，重兵守陆路一面；城门、码头依水而设，坛壝按制出城。',
    goals: (map, v) => {
      const land = [...all(map, 'ditai'), ...all(map, 'wengcheng')].filter((b) => !nearWater(map, b.hex, 2)).length;
      const matou = all(map, 'matou').filter((m) => neighbors(m.hex).some((n) => map.cell(n)?.terrain === 'R')).length;
      return [
        { text: '开城门不少于四座', done: all(map, 'gate').length >= 4, hint: `已开 ${all(map, 'gate').length} 座；明代襄阳有六门` },
        { text: '在无水的一面设敌台或瓮城两处以上', done: land >= 2, hint: `已有 ${land} 处；把鼠标移到城外看看哪里离水最远` },
        { text: '在汉江边设码头', done: matou >= 1, hint: '码头要紧贴大江' },
        { text: '社稷坛合制（得分 ≥ 80）', done: score(v, 'sheji') >= 80, hint: '礼制设于城外西北、罗盘乾位。若西北无地可设，就近设坛也可，但须说得出依据' },
        { text: '山川坛设在城南（得分 ≥ 80）', done: score(v, 'shanchuan') >= 80, hint: '坛在城外近郊、罗盘离位' },
        { text: '府署得分 ≥ 80', done: score(v, 'fushu') >= 80, hint: '城中或偏北' },
      ];
    },
  },
  {
    id: 'jingzhou', order: 3, ordinal: '三', cityName: '荆州府', title: '城绕水，水护城',
    blurb: '长江在南，城外濠水环绕，水门通舟。',
    source: { kind: 'level', city: 'jingzhou' }, keepWalls: true,
    intro: [
      '荆州城南距长江只有数里，城外护城河环绕一周，河水与江、湖相通。城墙上开有水门，舟船可以直接进出，粮食百货由码头上岸，市集就依着码头和城门。',
      '和襄阳「借天然之水」不同，荆州是「组织水」：把濠、江、湖连成一张网，既是防线，也是运输线。',
      '这一课城墙已经建好。补全护城河，开水门，在水边设码头和市肆，再把学宫放到东南文昌位。',
    ],
    takeaway: '理水为城：濠池环城为防，水门通舟为用，码头与市肆相依，城与水共生。',
    goals: (map, v) => {
      const matou = all(map, 'matou');
      const shisiNearMatou = all(map, 'shisi').filter((s) => matou.some((m) => PlanMap.dist(s.hex, m.hex) <= 2)).length;
      return [
        { text: '城池相依：七成以上城墙外临水', done: pattern(v, 'moat'), hint: '沿城墙外侧补护城河' },
        { text: '开水门一座', done: all(map, 'shuimen').length >= 1, hint: '水门建在临水的城墙上' },
        { text: '开城门不少于四座', done: all(map, 'gate').length >= 4, hint: `已开 ${all(map, 'gate').length} 座` },
        { text: '设码头，并在两格内设市肆', done: shisiNearMatou >= 1, hint: matou.length ? '在码头旁边放市肆' : '先在江河湖塘边设码头' },
        { text: '学宫设在城东南（得分 ≥ 85）', done: score(v, 'xuegong') >= 85, hint: '罗盘巽位，近水更好（泮池）' },
      ];
    },
  },
  {
    id: 'wuchang', order: 4, ordinal: '四', cityName: '武昌府', title: '含山的府城',
    blurb: '蛇山横贯城中，西临大江。',
    source: { kind: 'plan', map: 'wuchang' }, keepWalls: false,
    intro: [
      '武昌城西临长江，一道蛇山自江边的黄鹄矶向东横贯城中，把城分成南北两半。城墙不是绕开山，而是把山围进城里，山就成了城中的制高点和天然屏障。',
      '山南向阳背风，是安放重要建筑的好地方，据载明代楚王府就建在蛇山南麓；山头临江处，三国以来就有黄鹤楼，登楼可望汉阳、汉口。',
      '这一课没有现成的城墙。请把蛇山围进城里，在山之阳安放府署，在山头临江处起楼，把市井留在平地。',
      '<small>本图为示意级地形，依明清武昌府城图的大势画出，比例与细节不准确。</small>',
    ],
    takeaway: '山在城中，因山为势：城墙跨山合围，府署处山之阳，楼阁据山临江，市井列于平地。',
    goals: (map, v) => {
      const inside = map.inside();
      const hillInside = [...inside].filter((k) => map.cells.get(k)?.terrain === 'S').length;
      const fushu = all(map, 'fushu')[0];
      // 山在府署之北（r 更大）且两格以内
      const sunnySide = !!fushu && !map.isMountain(fushu.hex) &&
        [...map.cells.values()].some((c) => c.r > fushu.hex.r && map.isMountain(c) && PlanMap.dist(c, fushu.hex) <= 2);
      const flatMarkets = all(map, 'shisi').filter((s) => !map.isMountain(s.hex)).length;
      return [
        walledWithin(map, 40),
        { text: '把蛇山围进城内（城内山地不少于 5 格）', done: hillInside >= 5, hint: `城内山地 ${hillInside} 格；城墙要越过山脊` },
        { text: '府署设在山南麓（北面 1～2 格内有山）', done: sunnySide, hint: '向阳背风，山在府署之后' },
        { text: '楼阁据山临江（得分 ≥ 90）', done: score(v, 'louge') >= 90, hint: '放在山头，并且两格内有江水' },
        { text: '市肆两处以上，设在平地', done: flatMarkets >= 2, hint: `已有 ${flatMarkets} 处` },
        fourGates(map),
      ];
    },
  },
];

export const LESSON_BY_ID = new Map(LESSONS.map((l) => [l.id, l]));

/** 旧城墙线（v1 地形里的 C 格），作为提示高亮 */
export function oldWallKeys(rows: string[], qMin: number, rMin: number): Set<string> {
  const out = new Set<string>();
  rows.forEach((row, ri) => {
    for (let qi = 0; qi < row.length; qi++) if (row[qi] === 'C') out.add(hexKey({ q: qMin + qi, r: rMin + ri }));
  });
  return out;
}

// ---------- 进度 ----------

const KEY = 'sanfu.lessons.v1';

export interface LessonRecord {
  done: boolean;
  grade?: string;
  total?: number;
}

export function lessonProgress(): Record<string, LessonRecord> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveLessonResult(id: string, rec: LessonRecord): void {
  const all = lessonProgress();
  const prev = all[id];
  const better = !prev || (rec.total ?? 0) >= (prev.total ?? 0);
  all[id] = { done: true, grade: better ? rec.grade : prev.grade, total: better ? rec.total : prev.total };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // 存不了就只在本次有效
  }
}
