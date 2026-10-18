// 天下舆图（T08 实现）。
import type { Nav } from '../screens/nav';

export async function runWorld(nav: Nav, _at: string | null): Promise<void> {
  void nav.go('?custom=chongqing');
}
