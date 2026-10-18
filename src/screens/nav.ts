// 页面之间的跳转：云雾合拢后换页，新页面加载完再散开。

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

  home = () => this.go('');
  city = (id: string) => this.go(`?city=${id}`);
  compare = () => this.go('?view=compare');
}
