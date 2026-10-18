"""J02_far（远景简模，v1） 荆州大北门 · 拱辰门（朝宗楼）：宽大城台 34×22×9，前墙有砖砌壁柱（马面式竖向墙垛），门洞上方石匾；
台上五开间、进深三间的两层重檐歇山城楼（清道光重建的朝宗楼形制：面阔五间、进深三间、重檐歇山）。任务卡 J02。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

W, D, H, BATTER = 34, 22, 9, 0.08


def make():
    g = kit.Geo()
    g.add(kit.platform(W, D, H, batter=BATTER, arch=(5.5, 7.5), arch_ring=0.9))
    ins = BATTER * H
    g.add(kit.merlon_ring(W - 2 * ins, D - 2 * ins, H))
    # 前墙壁柱：四道竖向墙垛，略凸出
    for x in (-15.5, -6.5, 6.5, 15.5):
        g.add(kit.box(1.6, 1.0, H - 0.6, 'brick_light', x=x, y=-(D / 2) + 0.2, taper=0.05))
    zp = 8.0
    g.add(kit.box(4.0, 0.3, 1.2, 'marble', y=-(D / 2 - BATTER * zp) - 0.12, z=zp - 0.2))
    g.add(kit.hall(5, 3.6, 3, 3.6, 4.6, roof_kind='xieshan', stories=2, double=True, door_center=True,
                   base_mat='marble', base_h=0.6, overhang=2.0), t=(0, 0, H))
    g.add(kit.balustrade_ring(21.0, 14.8, H + 0.6))
    return g


run('J02_far', make, budget=30000)
