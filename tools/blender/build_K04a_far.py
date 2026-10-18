"""K04a 远景模型（v1 低精度版，供远近模型切换使用）。城门台 + 单檐城楼：城台 30×20×8，拱门洞 5×7 带浅色拱券；台上三开间单檐歇山城楼
（面阔 18、进深 10，粉墙朱框，明间开门）；城台两侧各接 10 米城墙。见任务卡 K04a。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402

W, D, H = 30, 20, 8
BATTER = 0.1


def make():
    g = kit.Geo()
    g.add(kit.platform(W, D, H, batter=BATTER, arch=(5, 7), arch_ring=0.8))
    ins = BATTER * H
    tw, td = W - 2 * ins, D - 2 * ins
    # 城台顶四周垛口（外侧高、内侧矮）
    g.add(kit.merlons_along(tw - 1.0, H, -td / 2 + 0.3, cap='tile'))
    g.add(kit.merlons_along(tw - 1.0, H, td / 2 - 0.3, h=1.0, cap='tile'))
    for sx in (-1, 1):
        g.add(kit.merlons_along(td - 2.0, H, 0, h=1.0, cap='tile'), t=(sx * (tw / 2 - 0.3), 0, 0), rot=90)
    # 城楼：三开间，按概念图约占城台顶宽六成 → 面阔 18、进深 10（任务卡给的 14×9 为估算，以概念图比例为准）
    g.add(kit.hall(3, 6.0, 2, 5.0, 5.0, roof_kind='xieshan', infill='plaster', door_center=True,
                   base_mat='brick_light', base_h=0.5, overhang=2.4, roof_h=4.4), t=(0, 0, H))
    # 两侧城墙
    for sx in (-1, 1):
        g.add(kit.wall(10, H, 4.8, 9.6, cap='tile'), t=(sx * (W / 2 + 5 - 0.6), 1.5, 0))
    return g


run('K04a_far', make, budget=15000)
