// 页面之间的跳转：云雾合拢后换页，新页面加载完再散开。
// 路由：'' 主界面；?view=classic 经典舆图；?view=world 天下舆图；?view=compare 三城对比；
// ?city= 寻访；?lesson= 营建课；?custom= 自定义营建（从天下舆图进入）。

import { CloudTransition } from '../ui/clouds';

const ARRIVING = 'sanfu.arriving';

export class Nav {
  readonly clouds = new CloudTransition(document.body);

  /** 页面启动时调用：如果是从别的页面跳过来的，先瞬间盖住，加载完由 arrive() 散开。 */
  async start(): Promise<void> {
    if (sessionStorage.getItem(ARRIVING)) {
      sessionStorage.removeItem(ARRIVING);
      await this.clouds.cover(1);
    }
  }

  async arrive(): Promise<void> {
    await this.clouds.reveal();
  }

  async go(query: string): Promise<void> {
    await this.clouds.cover();
    sessionStorage.setItem(ARRIVING, '1');
    location.search = query;
  }

  /** 主界面 */
  home = () => this.go('');
  /** 经典模式舆图（四城） */
  classic = () => this.go('?view=classic');
  /** 自定义模式的天下舆图；focus 为要居中的天下格 */
  world = (focus?: [number, number]) => this.go(focus ? `?view=world&at=${focus[0]},${focus[1]}` : '?view=world');
  city = (id: string) => this.go(`?city=${id}`);
  compare = () => this.go('?view=compare');
}
