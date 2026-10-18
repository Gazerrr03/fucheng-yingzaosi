"""X07_far（远景简模，v1） 东北外城 + 震华门：主城墙一段（东西向），其外侧（-Y）由外城墙围出一块突出的小城区；
外城南墙正中开门（城台 + 单檐城楼），城区内两组民居。任务卡 X07。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

OW, OD = 56.0, 34.0   # 外城范围


def make():
    g = kit.Geo()
    g.add(kit.wall(OW + 24, 8, 4.8, 9.6), t=(0, OD / 2 + 3, 0))                       # 主城墙（外侧朝 -Y）
    kw = dict(height=7, top_w=4.0, bottom_w=7.0)
    gate_w = 22.0
    seg = (OW - gate_w) / 2
    for sx in (-1, 1):
        g.add(kit.wall(seg, **kw), t=(sx * (gate_w / 2 + seg / 2), -OD / 2, 0))         # 外城南墙
    g.add(kit.wall(OD, **kw), t=(-OW / 2, 0, 0), rot=-90)                              # 西墙
    g.add(kit.wall(OD, **kw), t=(OW / 2, 0, 0), rot=90)                                # 东墙
    gate = kit.Geo()                                                                      # 震华门
    gate.add(kit.platform(gate_w, 14, 7, batter=0.08, arch=(4.5, 6), arch_ring=0.6))
    gate.add(kit.merlon_ring(gate_w - 1.1, 12.9, 7))
    gate.add(kit.hall(3, 4.0, 2, 3.8, 4.0, roof_kind='xieshan', infill='plaster', door_center=True,
                      base_mat='brick_light', base_h=0.4, overhang=1.6), t=(0, 0, 7))
    g.add(gate, t=(0, -OD / 2, 0))
    for x in (-14, 14):                                                                  # 城区民居
        g.add(kit.house(12, 7, 4.0, 2.4, gable='matou', steps=1), t=(x, 4, 0))
    return g


run('X07_far', make, budget=30000)
