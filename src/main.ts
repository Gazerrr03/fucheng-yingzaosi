import './style.css';
import './screens.css';
import { CITIES } from './game/cities';
import { Nav } from './screens/nav';
import { mountMuteButton } from './audio/sound';

// 路由见 screens/nav.ts：默认主界面；?view=classic 经典舆图；?view=world 天下舆图。
async function boot() {
  const nav = new Nav();
  mountMuteButton();
  await nav.start();
  const params = new URLSearchParams(location.search);
  const city = params.get('city');
  if (params.get('lesson')) {
    const { runLesson } = await import('./plan/entry');
    await runLesson(params.get('lesson')!, nav);
  } else if (params.get('custom')) {
    const { runCustom } = await import('./plan/entry');
    await runCustom(params.get('custom')!, nav);
  } else if (params.get('plan')) {
    const { runSandbox } = await import('./plan/entry');
    await runSandbox(params.get('plan')!, nav);
  } else if (city && CITIES.some((c) => c.id === city)) {
    const { runLevel } = await import('./screens/levelScreen');
    await runLevel(city, nav);
  } else if (params.get('view') === 'compare') {
    document.body.classList.add('page');
    const { runCompare } = await import('./screens/compare');
    await runCompare(nav);
  } else if (params.get('view') === 'classic') {
    document.body.classList.add('page');
    const { runOverview } = await import('./screens/overview');
    await runOverview(nav);
  } else if (params.get('view') === 'world') {
    const { runWorld } = await import('./world/worldScreen');
    await runWorld(nav, params.get('at'));
  } else {
    document.body.classList.add('page');
    const { runTitle } = await import('./screens/title');
    await runTitle(nav);
  }
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('#fatal')!.textContent = `加载失败：${err.message ?? err}`;
});
