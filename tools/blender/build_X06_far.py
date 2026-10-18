"""X06_far（远景简模，v1） 府儒学（文庙）：院落约 50×70，中轴自南向北为棂星门（石牌坊三间）→ 戟门（三开间）→ 大成殿
（五开间单檐歇山，台基 1.2），大成殿前东西两庑，棂星门外东西各一座牌坊（圣域坊、贤关坊）。任务卡 X06。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

W, D = 50.0, 70.0


def make():
    g = kit.Geo()
    g.add(kit.enclosure(W, D, 3.6, thick=0.7, gates=[('S', 0, 10)], material='vermilion', cap='tile'))
    g.add(kit.box(W - 2, D - 2, 0.15, 'stone'))  # 院内铺地
    g.add(kit.paifang(3, 11, 7, stone=True), t=(0, -D / 2 - 1.0, 0))                      # 棂星门
    for sx in (-1, 1):
        g.add(kit.paifang(1, 5, 5.5, stone=True), t=(sx * 16, -D / 2 - 8.0, 0))           # 圣域坊、贤关坊
    g.add(kit.hall(3, 4.0, 1, 6.0, 4.0, roof_kind='xieshan', door_center=True, overhang=1.4), t=(0, -16, 0))   # 戟门
    g.add(kit.box(26, 18, 1.2, 'marble', y=16))                                            # 大成殿月台
    g.add(kit.balustrade_ring(26, 18, 1.2, gap_front=6), t=(0, 16, 0))
    g.add(kit.stair(6, 3, 1.2), t=(0, 16 - 9 - 1.5, 0))
    g.add(kit.hall(5, 4.4, 3, 4.4, 5.6, roof_kind='xieshan', door_center=True, base_h=0.8, overhang=2.0), t=(0, 18, 1.2))  # 大成殿
    for sx in (-1, 1):                                                                       # 东西两庑
        g.add(kit.hall(6, 4.2, 1, 5.5, 3.8, roof_kind='yingshan', overhang=1.0), t=(sx * (W / 2 - 5), 0, 0), rot=90)
    return g


run('X06_far', make, budget=35000)
