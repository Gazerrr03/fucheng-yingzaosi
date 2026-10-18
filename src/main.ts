import './style.css';
import './screens.css';
import { CITIES } from './game/cities';
import { Nav } from './screens/nav';
import { mountMuteButton } from './audio/sound';

// 路由：?city=xxx 进入关卡，?view=compare 三城对比，否则三城总览。
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
  } else {
    document.body.classList.add('page');
    const { runOverview } = await import('./screens/overview');
    await runOverview(nav);
  }
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('#fatal')!.textContent = `加载失败：${err.message ?? err}`;
});
