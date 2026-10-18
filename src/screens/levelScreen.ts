import genes from '../../data/genes.json';
import { createContext, getDprCap, loadTexture, setDprCap } from '../render/gl';
import { assetUrl, fetchLevel, loadMarkerTextures } from '../game/assets';
import { buildLevel, type Site } from '../game/level';
import { fetchCards } from '../game/cards';
import { Progress } from '../game/progress';
import { MapView } from '../view/mapView';
import { TileView } from '../view/tileView';
import { Hud } from '../ui/hud';
import { InfoPanel } from '../ui/infoPanel';
import type { Nav } from './nav';
import { sound } from '../audio/sound';
import { CITIES, GENE_COUNT, cityLitGenes } from '../game/cities';

async function allCitiesComplete(progress: Progress): Promise<boolean> {
  const all = await Promise.all(CITIES.map((c) => fetchLevel(c.id)));
  return all.every((d) => cityLitGenes(d, progress).length === GENE_COUNT);
}

type State = 'map' | 'entering' | 'tile' | 'leaving';

export async function runLevel(CITY: string, nav: Nav): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
  const hudRoot = document.querySelector<HTMLElement>('#hud')!;
  const gl = createContext(canvas);

  const [data, cards] = await Promise.all([fetchLevel(CITY), fetchCards(CITY)]);
  const [mapTex, markerTex] = await Promise.all([loadTexture(gl, assetUrl(data.map)), loadMarkerTextures(gl)]);

  const level = buildLevel(data, [mapTex.width, mapTex.height]);
  for (const issue of level.issues) console.warn(`[关卡 ${data.id}] ${issue}`);

  const progress = new Progress();
  let visited = progress.visited(CITY);
  let state: State = 'map';
  let completePending = false;

  const clouds = nav.clouds;
  const tile = new TileView(gl, canvas, mapTex);

  const hud = new Hud(hudRoot, level, genes, cards, {
    onEnter: (site) => void enter(site),
    onCloseSite: () => {
      hud.showSite(null);
      view.clearSelection();
    },
    onReset: () => {
      progress.reset(CITY);
      visited = progress.visited(CITY);
      hud.setProgress(visited);
      view.setVisited(visited);
    },
    onHome: () => void nav.classic(),
    onCompare: () => void nav.compare(),
  });

  const panel = new InfoPanel(document.body, level, genes, cards, {
    onRead: (site) => {
      progress.markVisited(CITY, site.id);
      visited = progress.visited(CITY);
      const wasComplete = hud.complete;
      const fresh = hud.setProgress(visited, true);
      if (fresh.length) sound.stamp();
      panel.stamp(fresh, visited);
      view.setVisited(visited);
      if (!wasComplete && hud.complete) completePending = true;
    },
    onBack: () => void leave(),
  });

  let lastHoverSite: Site | null = null;
  // 环境声：都有风，临江河的城市再加流水
  sound.ambient(level.terrain.size && [...level.terrain.values()].some((t) => t === 'R') ? ['wind', 'river'] : ['wind']);
  const view: MapView = new MapView(gl, canvas, level, mapTex, markerTex, {
    onHover: (info) => {
      if (info?.site && info.site !== lastHoverSite) sound.tick();
      lastHoverSite = info?.site ?? null;
      hud.showHover(info);
    },
    onSelect: (site) => {
      sound.click();
      hud.showSite(site, visited.has(site.id));
    },
  });
  hud.setProgress(visited);
  view.setVisited(visited);

  async function enter(site: Site) {
    if (state !== 'map') return;
    state = 'entering';
    hud.showSite(null);
    hud.showHover(null);
    view.inputEnabled = false;
    // 云合拢和地块加载同时进行
    await Promise.all([clouds.cover(), tile.load(level, site)]);
    hud.setVisible(false);
    panel.open(site, visited);
    tile.rightInset = panel.width;
    tile.active = true;
    await clouds.reveal();
    state = 'tile';
  }

  async function leave() {
    if (state !== 'tile') return;
    state = 'leaving';
    await clouds.cover(700);
    panel.close();
    tile.active = false;
    view.inputEnabled = true;
    view.clearSelection();
    hud.setVisible(true);
    await clouds.reveal(900);
    state = 'map';
    if (completePending) {
      completePending = false;
      hud.showComplete(await allCitiesComplete(progress));
      sound.bell();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state === 'tile') void leave();
      else if (state === 'map') {
        hud.showSite(null);
        view.clearSelection();
      }
    }
    // 调试：T 切换地形叠加
    if ((e.key === 't' || e.key === 'T') && state === 'map') view.overlay = view.overlay > 0 ? 0 : 0.45;
  });
  window.addEventListener('resize', () => {
    if (tile.active) tile.rightInset = panel.width;
  });

  // 调试用：控制台里可以访问
  Object.assign(window, {
    __level: level, __view: view, __tile: tile, __progress: progress,
    /** 直接进入某个地点的地块，例如 __enter('xicheng') */
    __enter: (id: string) => {
      const site = level.sites.find((s) => s.id === id);
      if (site) void enter(site);
    },
  });

  // 画质自动降档：连续约 2 秒平均帧间隔超过 25 ms，就把像素密度降到 1
  let slowFrames = 0;
  const watchPerf = (rawDt: number) => {
    if (getDprCap() <= 1 || document.visibilityState !== 'visible') return;
    slowFrames = rawDt > 0.025 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
    if (slowFrames > 90) {
      setDprCap(1);
      console.info('[画质] 帧率偏低，像素密度降到 1');
      view.resize();
      tile.resize();
    }
  };

  let last = performance.now();
  const loop = (now: number) => {
    watchPerf((now - last) / 1000);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (tile.active) tile.frame(dt);
    else view.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.body.classList.add('ready');
  await nav.arrive();
}
