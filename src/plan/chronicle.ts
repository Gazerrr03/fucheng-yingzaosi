// 史书：玩家名号、营建记的生成（仿宋明「重修记」与地方志的写法）、卷宗存取。

import { DIR_NAME, type Dir } from './buildings';
import { chineseDate } from './calendar';
import { zhouhuiLi, type CityVerdict } from './fengshui';
import type { Lesson } from './lessons';
import type { PlanMap } from './planMap';

// ---------------------------------------------------------------- 名号

export const OFFICES = ['知府', '同知', '通判', '推官', '知州', '知县', '县丞', '布政使', '按察使', '工部主事', '山人', '布衣'];

export interface Profile {
  name: string;
  office: string;
}

const PROFILE_KEY = 'sanfu.profile.v1';

export function loadProfile(): Profile | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
    return p?.name ? p : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: p.name.trim().slice(0, 12), office: p.office }));
  } catch {
    // 忽略
  }
}

/** 署名：官职 + 名号。「山人」「布衣」放在名号前也通。 */
export const signature = (p: Profile) => `${p.office}${p.name}`;

// ---------------------------------------------------------------- 数字

const N = '〇一二三四五六七八九';

export function cnNum(n: number): string {
  n = Math.round(n);
  if (n < 0) return `负${cnNum(-n)}`;
  if (n < 10) return N[n];
  if (n < 20) return `十${n % 10 ? N[n % 10] : ''}`;
  if (n < 100) return `${N[Math.floor(n / 10)]}十${n % 10 ? N[n % 10] : ''}`;
  if (n < 1000) {
    const rest = n % 100;
    return `${N[Math.floor(n / 100)]}百${rest === 0 ? '' : rest < 10 ? `〇${N[rest]}` : rest < 20 ? `一${cnNum(rest)}` : cnNum(rest)}`;
  }
  return String(n);
}

// ---------------------------------------------------------------- 营建记

export interface ChronicleEntry {
  id: string;
  at: string;
  mapId: string;
  mapName: string;
  mode: 'lesson' | 'custom';
  lessonId?: string;
  title: string;
  body: string[];
  author: string;
  dateText: string;
  grade: string;
  total: number;
  /** 第几次营建（同一张图） */
  revision: number;
  /** 从分享码续修时，原作者 */
  origin?: string;
  layout: [number, number, string][];
  /** 卷首小图（JPEG dataURL） */
  thumb?: string;
}

const WATER_VERB: Record<Dir, string> = { N: '北枕', NE: '东北接', E: '东濒', SE: '东南汇', S: '南临', SW: '西南绕', W: '西带', NW: '西北引' };
const HILL_VERB: Record<Dir, string> = { N: '北负', NE: '东北拥', E: '东屏', SE: '东南峙', S: '南倚', SW: '西南障', W: '西拥', NW: '西北据' };

const GRADE_WORDS: Record<string, string> = {
  上上: '形胜俱全，规制咸备，堪舆家以为上上之局。',
  上中: '规制完备，虽有小疵，不掩其美。',
  中上: '大体合度，而方位之间尚有可议者。',
  中: '规模初具，方位多有未合，犹待润色。',
  下: '草创而已，后之君子当有以正之。',
};

function dirWord(map: PlanMap, id: string): string | null {
  const b = [...map.buildings()].find((x) => x.def.id === id);
  if (!b) return null;
  const { dir } = map.dirOf(b.hex);
  return dir === 'C' ? '城之中' : `城${DIR_NAME[dir]}`;
}

function count(map: PlanMap, id: string): number {
  return map.count(id);
}

/** 山水形势一句：「北枕汉江，南倚岘山」 */
function settingSentence(v: CityVerdict): string {
  const s = v.setting;
  const water = s.waterName ?? '大江';
  const hill = s.mountainName ?? '群山';
  const parts: string[] = [];
  if (s.waters[0]) parts.push(`${WATER_VERB[s.waters[0]]}${water}`);
  if (s.mountains[0]) parts.push(`${HILL_VERB[s.mountains[0]]}${hill}`);
  const sh = v.patterns.find((p) => p.id === 'shanshui');
  let tail: string;
  if (sh?.ok) tail = '背山面水，得形胜之宜';
  else if (parts.length === 2) tail = '山水环抱，不拘常格';
  else if (parts.length === 1) tail = s.waters[0] ? '以水为险' : '以山为屏';
  else tail = '四望平畴，无险可恃';
  return `其地${parts.length ? `${parts.join('，')}，` : ''}${tail}。`;
}

function worksSentences(map: PlanMap, v: CityVerdict, isNew: boolean): string[] {
  const out: string[] = [];
  const walls = [...map.buildings()].filter((b) => b.def.wallish).length;
  if (map.walled) {
    const li = Number(zhouhuiLi(map, walls));
    const liText = li < 1 ? '不及一里' : `${cnNum(Math.floor(li))}里${li - Math.floor(li) >= 0.2 ? '有奇' : ''}`;
    const gates = [...map.buildings()].filter((b) => b.def.id === 'gate');
    const dirs = [...new Set(gates.map((g) => map.dirOf(g.hex).dir).filter((d) => d !== 'C'))] as Dir[];
    let s = `${isNew ? '筑城' : '城'}周${liText}`;
    if (gates.length) {
      s += `，辟门${cnNum(gates.length)}`;
      if (gates.length === 4 && dirs.length === 4) s += '，东西南北各一';
      else if (dirs.length) s += `，在${dirs.map((d) => DIR_NAME[d]).join('、')}`;
    } else s += '，而门未辟';
    out.push(`${s}。`);
    const extras: string[] = [];
    if (count(map, 'wengcheng')) extras.push(`门外筑瓮城${cnNum(count(map, 'wengcheng'))}`);
    if (count(map, 'jiaolou')) extras.push(count(map, 'jiaolou') >= 4 ? '四隅置角楼' : `置角楼${cnNum(count(map, 'jiaolou'))}`);
    if (count(map, 'ditai')) extras.push(`列敌台${cnNum(count(map, 'ditai'))}座以补陆路之防`);
    if (v.patterns.find((p) => p.id === 'moat')?.ok) extras.push(count(map, 'moat') ? '城外凿濠以环之' : '因水为池');
    if (count(map, 'shuimen')) extras.push(`开水门${cnNum(count(map, 'shuimen'))}以通舟楫`);
    if (extras.length) out.push(`${extras.join('，')}。`);
  } else if (walls) {
    out.push('城垣初起，未及合围。');
  }

  const civic: string[] = [];
  const fushu = dirWord(map, 'fushu');
  if (fushu) civic.push(`府署居${fushu}，坐北面南`);
  if (count(map, 'xianshu')) civic.push('县署附焉');
  const gulou = dirWord(map, 'gulou');
  if (gulou) civic.push(`钟鼓楼峙于${gulou}`);
  if (civic.length) out.push(`${civic.join('，')}。`);

  const rites: string[] = [];
  const xue = dirWord(map, 'xuegong');
  if (xue) rites.push(`学宫在${xue}，以兴文教`);
  if (count(map, 'chenghuang')) rites.push('城隍有庙');
  const altars = (['sheji', 'shanchuan', 'litan'] as const)
    .map((id) => [id, dirWord(map, id)] as const)
    .filter(([, d]) => d);
  if (altars.length) {
    const names = { sheji: '社稷坛', shanchuan: '山川坛', litan: '厉坛' };
    const ok = v.patterns.find((p) => p.id === 'altars')?.ok;
    rites.push(`${altars.map(([id, d]) => `${names[id]}于${d}`).join('，')}${ok ? '，皆遵洪武之制' : ''}`);
  }
  if (count(map, 'kuixing')) rites.push('巽隅起魁星楼，以振文运');
  if (count(map, 'shuyuan')) rites.push(`书院${count(map, 'shuyuan') > 1 ? cnNum(count(map, 'shuyuan')) + '所' : '一所'}，延师讲学`);
  if (count(map, 'louge')) {
    const lg = [...map.buildings()].find((b) => b.def.id === 'louge')!;
    rites.push(`${map.isMountain(lg.hex) ? '山巅' : '城隅'}起楼${count(map, 'louge') > 1 ? '二' : ''}，以供登临`);
  }
  if (rites.length) out.push(`${rites.join('；')}。`);

  const town: string[] = [];
  if (count(map, 'shisi')) town.push(`市肆${cnNum(count(map, 'shisi'))}所`);
  if (count(map, 'matou')) town.push(`埠头${cnNum(count(map, 'matou'))}处，舟楫辐辏`);
  if (count(map, 'minju')) town.push(`坊居${cnNum(count(map, 'minju'))}区`);
  if (town.length) out.push(`${town.join('，')}，百姓安之。`);
  return out;
}

export interface ChronicleInput {
  map: PlanMap;
  verdict: CityVerdict;
  mode: 'lesson' | 'custom';
  lesson?: Lesson;
  profile: Profile;
  revision: number;
  origin?: string;
  date?: Date;
}

export function composeChronicle(input: ChronicleInput): Omit<ChronicleEntry, 'id' | 'layout' | 'thumb'> {
  const { map, verdict: v, mode, lesson, profile, revision, origin } = input;
  const date = input.date ?? new Date();
  const cd = chineseDate(date);
  const author = signature(profile);
  const city = map.data.name.replace(/(府|城)$/, '');
  const cityFull = map.data.name.endsWith('府') ? map.data.name : `${map.data.name}城`;
  const verb = origin ? '续修' : revision > 1 || (mode === 'lesson' && lesson?.keepWalls) ? '重修' : '新筑';
  const title = `${verb}${city}${map.data.name.endsWith('府') ? '府城' : '城'}记`;

  const body: string[] = [];
  // 起
  let open = `${cd.full}，${author}`;
  if (origin) open += `得${origin}所营${cityFull}之图，续而修之。`;
  else if (mode === 'lesson' && lesson?.keepWalls) open += `莅任${cityFull}，因旧城而重加营缮。`;
  else if (revision > 1) open += `复治${cityFull}，此其第${cnNum(revision)}修也。`;
  else open += `相其阴阳，观其流泉，始营${cityFull}。`;
  body.push(open);
  // 地
  body.push(settingSentence(v));
  // 工
  const works = worksSentences(map, v, verb === '新筑');
  if (works.length) body.push(works.join(''));
  // 议礼
  const yili = (v.yili ?? []).map((y) => y.chronicle).filter(Boolean);
  if (yili.length) body.push(yili.join(''));
  // 评
  let judge = GRADE_WORDS[v.grade] ?? '';
  if (mode === 'lesson' && lesson) judge += `是役也，${lesson.takeaway.replace(/。$/, '').replace(/[：；]/g, '，')}，斯其要也。`;
  else judge += '后之览者，或有感于斯焉。';
  body.push(judge);
  body.push(`${author}谨记。时${cd.short}。`);

  return {
    at: date.toISOString(),
    mapId: map.data.id,
    mapName: map.data.name,
    mode,
    lessonId: lesson?.id,
    title,
    body,
    author,
    dateText: cd.full,
    grade: v.grade,
    total: v.total,
    revision,
    origin,
  };
}

// ---------------------------------------------------------------- 卷宗

const BOOK_KEY = 'sanfu.chronicle.v1';
const MAX_ENTRIES = 60;

export function loadBook(): ChronicleEntry[] {
  try {
    return JSON.parse(localStorage.getItem(BOOK_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function addToBook(e: ChronicleEntry): void {
  let book = [e, ...loadBook()].slice(0, MAX_ENTRIES);
  for (;;) {
    try {
      localStorage.setItem(BOOK_KEY, JSON.stringify(book));
      return;
    } catch {
      // 空间不够：先去掉旧卷的小图，再去掉最旧的卷
      const withThumb = [...book].reverse().find((x) => x.thumb);
      if (withThumb) withThumb.thumb = undefined;
      else if (book.length > 1) book = book.slice(0, -1);
      else return;
    }
  }
}

export function nextRevision(mapId: string, mode: 'lesson' | 'custom'): number {
  return loadBook().filter((e) => e.mapId === mapId && e.mode === mode).length + 1;
}

/** 城心附近的世界坐标（截图对焦用） */
export function cityFocus(map: PlanMap): [number, number] {
  return map.center();
}
