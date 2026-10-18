"""K04b_far（远景简模，v1） 城门台 + 重檐城楼：城台 36×22×8，门洞 6×7.5 带拱券；台上五开间两层重檐歇山城楼
（面阔约 22、进深 12），两侧各接 10 米城墙。任务卡 K04b。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

W, D, H, BATTER = 36, 22, 8, 0.08


def make():
    g = kit.Geo()
    g.add(kit.platform(W, D, H, batter=BATTER, arch=(6, 7.5), arch_ring=0.9))
    ins = BATTER * H
    g.add(kit.merlon_ring(W - 2 * ins, D - 2 * ins, H))
    g.add(kit.hall(5, 4.4, 2, 6.0, 5.0, roof_kind='xieshan', stories=2, door_center=True,
                   base_mat='marble', base_h=0.6, overhang=2.2), t=(0, 0, H))
    g.add(kit.balustrade_ring(24.4, 15.4, H + 0.6), t=(0, 0, 0))
    for sx in (-1, 1):
        g.add(kit.wall(10, H, 4.8, 9.6), t=(sx * (W / 2 + 5 - 0.6), 1.5, 0))
    return g


run('K04b_far', make, budget=25000)
