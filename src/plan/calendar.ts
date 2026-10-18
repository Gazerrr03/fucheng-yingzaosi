// 纪年：公元年份写成中文数字，农历月日、干支、时辰用浏览器自带的农历日历换算（Intl，zh-u-ca-chinese）。
// 例：2016-09-03 下午 → 「公元二〇一六年，岁次丙申，八月初三日未时」

const DIGIT = '〇一二三四五六七八九';
const NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';

export interface ChineseDate {
  /** 公元二〇二六年 */
  year: string;
  /** 丙午 */
  ganzhi: string;
  /** 九月、闰六月 */
  month: string;
  /** 初九、十五、廿三 */
  day: string;
  /** 未时 */
  shichen: string;
  /** 完整一句：公元二〇二六年，岁次丙午，九月初九日未时 */
  full: string;
  /** 落款用：丙午年九月初九 */
  short: string;
}

export function yearDigits(y: number): string {
  return String(y).split('').map((d) => DIGIT[Number(d)]).join('');
}

export function lunarDay(d: number): string {
  if (d === 10) return '初十';
  if (d === 20) return '二十';
  if (d === 30) return '三十';
  const tens = Math.floor(d / 10);
  return ['初', '十', '廿', '卅'][tens] + NUM[d % 10];
}

export function ganzhiOfYear(y: number): string {
  const i = (((y - 4) % 60) + 60) % 60;
  return STEMS[i % 10] + BRANCHES[i % 12];
}

/** 子时从前一日 23 点起 */
export function shichen(hour: number): string {
  return `${BRANCHES[Math.floor(((hour + 1) % 24) / 2)]}时`;
}

export function chineseDate(date = new Date()): ChineseDate {
  let ganzhi = ganzhiOfYear(date.getFullYear());
  let month = '';
  let day = '';
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', month: 'long', day: 'numeric' }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    ganzhi = get('yearName') ?? ganzhi;
    month = get('month') ?? '';
    const d = Number(get('day'));
    day = d ? lunarDay(d) : '';
  } catch {
    // 不支持农历的环境：只写公历月日
  }
  if (!month) {
    month = `${NUM[date.getMonth() + 1] || `十${NUM[date.getMonth() - 9]}`}月`;
    day = lunarDay(date.getDate());
  }
  const year = `公元${yearDigits(date.getFullYear())}年`;
  const sc = shichen(date.getHours());
  return {
    year, ganzhi, month, day, shichen: sc,
    full: `${year}，岁次${ganzhi}，${month}${day}日${sc}`,
    short: `${ganzhi}年${month}${day}`,
  };
}
