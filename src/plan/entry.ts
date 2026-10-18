// 营建模式入口：?lesson=<课> 经典营建课、?custom=<图> 自定义模式、?plan=<城> 沙盘（开发用）。

import './plan.css';
import { fetchJSON, fetchLevel } from '../game/assets';
import type { Nav } from '../screens/nav';
import { LESSON_BY_ID, LESSONS, oldWallKeys, saveLessonResult, type Lesson } from './lessons';
import { PlanMap, type PlanMapJSON } from './planMap';
import { openModal, runPlan, type PlanUI } from './planScreen';
import { decodeShare, setOrigin } from './share';
import { fetchYili } from './yili';
import { Progress, addReputation, cardUnlocked, loadYili, saveYili } from '../game/progress';
import type { YiliHooks } from './planScreen';

export const fetchPlanMap = (id: string) => fetchJSON<PlanMapJSON>(`data/plan/${id}.json`);

/** 经典关卡的议礼：读该城的议礼数据，按探索模式的进度判断方志是否已点亮。 */
async function lessonYili(lesson: Lesson, sites: { id: string; cards: string[] }[], oldWalls: Set<string>): Promise<YiliHooks | undefined> {
  if (lesson.source.kind !== 'level') return undefined;
  const city = lesson.source.city;
  const file = await fetchYili(city);
  if (!file?.events.length) return undefined;
  const scope = `lesson:${lesson.id}`;
  return {
    events: file.events,
    records: loadYili(scope),
    unlocked: (card) => cardUnlocked(sites, new Progress().visited(city), card),
    exploreHref: `?city=${city}`,
    oldWalls,
    save: (records) => saveYili(scope, records),
    onReputation: (name, ev) => void addReputation({ name, source: ev.title, city }),
  };
}

async function lessonMap(lesson: Lesson): Promise<{ map: PlanMap; oldWalls: Set<string>; sites: { id: string; cards: string[] }[] }> {
  if (lesson.source.kind === 'plan') return { map: new PlanMap(await fetchPlanMap(lesson.source.map)), oldWalls: new Set(), sites: [] };
  const data = await fetchLevel(lesson.source.city);
  const t = data.terrain!;
  const json = PlanMap.fromLevel(lesson.id, data.name, t, {
    hexAcross: data.grid.hexAcross, keepWalls: lesson.keepWalls, lockWalls: true, terrainNames: data.terrainNames,
  });
  json.subtitle = data.subtitle;
  return { map: new PlanMap(json), oldWalls: lesson.showOldWalls ? oldWallKeys(t.rows, t.qMin, t.rMin) : new Set(), sites: data.sites };
}

const bookButton = {
  label: '史书', title: '翻阅历次营建记、更改名号',
  onClick: async (ui: PlanUI) => (await import('./chronicleUI')).showBook(ui.root),
};

async function importShare(ui: PlanUI, mapId: string, map: PlanMap, nav: Nav): Promise<void> {
  const html = `<span class="kicker">城池码</span><h2>导入他人的城</h2>
    <p>粘贴同好分享的城池码（以 SF1 开头）。导入后会<b>替换</b>这张图上现有的营建，之后修成的史书会记作「续修」。</p>
    <textarea class="share-in" rows="4" placeholder="SF1.chongqing.…"></textarea>`;
  if ((await openModal(ui.root, html, '导入', '取消')) !== 0) return;
  const code = ui.root.querySelector<HTMLTextAreaElement>('.share-in')?.value ?? '';
  try {
    const shared = decodeShare(code);
    if (!CUSTOM_MAPS.some((m) => m.id === shared.mapId) && !/^w/.test(shared.mapId)) throw new Error(`不认识的地图：${shared.mapId}`);
    setOrigin(shared.mapId, shared.author);
    if (shared.mapId !== mapId) {
      localStorage.setItem(layoutKey('custom', shared.mapId), JSON.stringify(shared.layout));
      void nav.go(`?custom=${shared.mapId}`);
      return;
    }
    map.restore(shared.layout);
    saveLayout('custom', mapId, map);
    ui.refresh();
    ui.toast(`已导入${shared.author}所营之城，共 ${shared.layout.length} 处营建`);
  } catch (err) {
    ui.toast(`导入失败：${(err as Error).message}`);
  }
}

const layoutKey = (kind: string, id: string) => `sanfu.plan.${kind}.${id}`;

export function loadLayout(kind: string, id: string): [number, number, string][] | null {
  try {
    return JSON.parse(localStorage.getItem(layoutKey(kind, id)) ?? 'null');
  } catch {
    return null;
  }
}

export function saveLayout(kind: string, id: string, map: PlanMap): void {
  try {
    localStorage.setItem(layoutKey(kind, id), JSON.stringify(map.snapshot()));
  } catch {
    // 忽略
  }
}

export async function runLesson(id: string, nav: Nav): Promise<void> {
  const lesson = LESSON_BY_ID.get(id);
  if (!lesson) throw new Error(`没有这一课：${id}`);
  const { map, oldWalls, sites } = await lessonMap(lesson);
  const yili = await lessonYili(lesson, sites, oldWalls);
  const saved = loadLayout('lesson', id);
  if (saved) map.restore(saved);
  const next = LESSONS.find((l) => l.order === lesson.order + 1);

  const intro = `
    <span class="kicker">经典模式 · 第${lesson.ordinal}课</span>
    <h2>${lesson.cityName} · ${lesson.title}</h2>
    ${lesson.intro.map((p) => `<p>${p}</p>`).join('')}
    <p class="kicker">右侧「本课目标」全部达成即可过关。鼠标悬停可以预览每一处的风水评价。</p>`;

  const ui = runPlan({
    map,
    title: lesson.cityName,
    subtitle: lesson.title,
    tag: `经典 · 第${lesson.ordinal}课`,
    palette: lesson.palette,
    goals: lesson.goals,
    yili,
    intro: saved ? undefined : intro,
    finishLabel: '过　关',
    canFinish: (m, v) => lesson.goals(m, v).every((g) => g.done),
    onChange: (m) => saveLayout('lesson', id, m),
    onFinish: async (_m, v, ui) => {
      saveLessonResult(id, { done: true, grade: v.grade, total: v.total });
      const { writeChronicle } = await import('./chronicleUI');
      await writeChronicle(ui, { map, verdict: v, mode: 'lesson', lesson });
      const choice = await openModal(ui.root, `
        <span class="kicker">第${lesson.ordinal}课 · 已过关</span>
        <h2>${lesson.title}</h2>
        <p>${lesson.takeaway}</p>
        <p>风水总评：<b>${v.grade}</b>（${v.total}）</p>
        ${(v.yili ?? []).map((y) => `<p class="kicker">议礼 · ${y.title.replace(/^议礼 · /, '')}：${y.label} —— ${y.note}${y.reputation ? `，得「${y.reputation}」` : ''}</p>`).join('')}
        ${v.modifiers.length ? `<p class="kicker">考成修正：${v.modifiers.map((m) => `${m.name} ${m.delta > 0 ? '+' : ''}${m.delta}`).join('；')}</p>` : ''}`,
        ...(next ? [`下一课：${next.cityName}`, '留在本城', '返回舆图'] : ['返回舆图', '留在本城']));
      const label = next ? [`next`, 'stay', 'home'][choice] : ['home', 'stay'][choice];
      if (label === 'next') void nav.go(`?lesson=${next!.id}`);
      else if (label === 'home') void nav.classic();
    },
    extraButtons: [
      { label: '讲解', title: '重看本课讲解', onClick: (ui) => void openModal(ui.root, intro, '继续营建') },
      bookButton,
      {
        label: '重来', title: '清空本课的营建',
        onClick: (ui) => {
          if (!confirm('清空本课的营建，从头再来？')) return;
          map.restore([]);
          saveLayout('lesson', id, map);
          ui.refresh();
        },
      },
    ],
    onHome: () => void nav.classic(),
  });
  ui.view.highlight = oldWalls;
  ui.view.invalidate();
  document.body.classList.add('ready');
  await nav.arrive();
}

export async function runSandbox(city: string, nav: Nav): Promise<void> {
  const data = await fetchLevel(city);
  const map = new PlanMap(PlanMap.fromLevel(city, data.name, data.terrain!, { hexAcross: data.grid.hexAcross, keepWalls: true, terrainNames: data.terrainNames }));
  runPlan({
    map,
    title: data.name,
    subtitle: data.subtitle,
    tag: '沙盘',
    finishLabel: '完成',
    onFinish: (_m, v, ui) => ui.toast(`风水总评 ${v.grade}（${v.total}）`),
    onHome: () => void nav.home(),
  });
  document.body.classList.add('ready');
  await nav.arrive();
}


/** 自定义模式可选的地图：营建地图（data/plan）或 v1 关卡地形（自由营建，不预置城墙） */
export const CUSTOM_MAPS: { id: string; name: string; blurb: string; source: 'plan' | 'level' }[] = [
  { id: 'chongqing', name: '重庆', blurb: '绕城高速以内 · 两江交汇、两山夹峙（示意）', source: 'plan' },
  { id: 'wuchang', name: '武昌', blurb: '蛇山横贯、西临大江（示意）', source: 'plan' },
  { id: 'xiangyang', name: '襄阳', blurb: '汉水南岸、岘山之北', source: 'level' },
  { id: 'jingzhou', name: '荆州', blurb: '长江北岸、湖网之间', source: 'level' },
  { id: 'baoding', name: '保定', blurb: '冀中平原、西望太行', source: 'level' },
];

export async function customMap(id: string): Promise<PlanMap> {
  const entry = CUSTOM_MAPS.find((m) => m.id === id);
  if (!entry) {
    // 天下舆图上择址生成的城址
    const { hexOfSiteId } = await import('../world/worldScreen');
    const h = hexOfSiteId(id);
    if (!h) throw new Error(`没有这张地图：${id}`);
    const [{ WorldMap }, { generateSite }, { evaluateSite }, { getFounding }] = await Promise.all([
      import('../world/worldMap'), import('../world/siteGen'), import('../world/siteScore'), import('../world/foundings'),
    ]);
    const world = await WorldMap.load();
    if (!world.cell(h)) throw new Error(`天下舆图上没有这一格：${id}`);
    const f = getFounding(id);
    return new PlanMap(generateSite(world, h, id, { name: f?.name ?? '新府', verdict: evaluateSite(world, h) }));
  }
  if (entry.source === 'plan') return new PlanMap(await fetchPlanMap(id));
  const data = await fetchLevel(id);
  const json = PlanMap.fromLevel(id, data.name, data.terrain!, { hexAcross: data.grid.hexAcross, keepWalls: false, terrainNames: data.terrainNames });
  json.subtitle = data.subtitle;
  return new PlanMap(json);
}

export async function runCustom(mapId: string, nav: Nav): Promise<void> {
  const { getFounding, updateFounding } = await import('../world/foundings');
  const founding = getFounding(mapId);
  const map = await customMap(mapId);
  const json = map.data;
  const saved = loadLayout('custom', mapId);
  if (saved) map.restore(saved);
  const title = founding?.name ?? json.name;
  const intro = `<span class="kicker">自定义模式 · ${json.kind === 'real' ? '真实地图' : '城址'}</span>
    <h2>${title}</h2>
    <p>${json.subtitle ?? ''}</p>
    ${json.ring ? `<p>红色虚线是${json.ringName ?? '可建范围'}，只能在线内营建。</p>` : ''}
    <p>先看山水：江在哪一面、山在哪一面。选「城墙」后<b>按住拖动</b>就能沿路一口气筑墙，首尾相接即成城；选中任一构件，全图会标出每处能得几分，挑绿的放。</p>
    <p>营建满意后点「修成史书」，写下一卷营建记，并生成可以分享的城池码。随时可点「回舆图」另择他处。</p>
    ${json.note ? `<p><small>${json.note}</small></p>` : ''}`;
  const back = () => void nav.world(founding ? founding.hex : undefined);
  let gradeTimer = 0;

  runPlan({
    map,
    title,
    subtitle: json.subtitle ?? '',
    tag: json.kind === 'real' ? '自定义 · 真实地图' : '自定义 · 城址',
    intro: saved?.length ? undefined : intro,
    finishLabel: '修成史书',
    canFinish: (_m, v) => v.buildings.some((b) => b.def.id !== 'wall'),
    onChange: (m) => {
      saveLayout('custom', mapId, m);
      if (!founding) return;
      clearTimeout(gradeTimer);
      gradeTimer = window.setTimeout(async () => {
        const { evaluateCity } = await import('./fengshui');
        const v = evaluateCity(m);
        const built = v.buildings.some((b) => b.def.id !== 'wall');
        updateFounding(mapId, built ? { grade: v.grade, total: v.total } : { grade: undefined, total: undefined });
      }, 400);
    },
    onFinish: async (_m, v, ui) => {
      if (founding) updateFounding(mapId, { grade: v.grade, total: v.total });
      const { writeChronicle } = await import('./chronicleUI');
      await writeChronicle(ui, { map, verdict: v, mode: 'custom' });
    },
    extraButtons: [
      { label: '回舆图', title: '回到天下舆图另择他处（营建自动保存）', onClick: back },
      { label: '导入城池码', onClick: (ui) => void importShare(ui, mapId, map, nav) },
      bookButton,
      {
        label: '清空',
        title: '拆掉本图的全部营建',
        onClick: (ui) => {
          if (!confirm(`拆掉${title}的全部营建？（史书里的记载不受影响）`)) return;
          setOrigin(mapId, null);
          map.restore([]);
          saveLayout('custom', mapId, map);
          ui.refresh();
        },
      },
    ],
    onHome: back,
  });
  document.body.classList.add('ready');
  await nav.arrive();
}
