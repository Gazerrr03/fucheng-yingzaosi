"""X07 东北外城 + 震华门（构件库 v2）：主城墙一段（东西向，城墙 v2），外侧（-Y）由外城墙围出一块
突出的小城区；外城南墙正中开震华门（城台 22×14×7、拱券门洞、三开间单檐歇山城楼）；城区内民居 v2
（粉墙、马头墙、硬山瓦顶）。任务卡 X07；远景简模见 build_X07_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

OW, OD = 56.0, 34.0   # 外城范围


def make():
    g = kit.Geo()
    g.add(kit2.wall2(OW + 24, 8, 4.8, 9.6), t=(0, OD / 2 + 3, 0))                       # 主城墙（外侧朝 -Y）
    kw = dict(height=7, top_w=3.6, bottom_w=7.0)
    gate_w = 22.0
    seg = (OW - gate_w) / 2
    for sx in (-1, 1):
        g.add(kit2.wall2(seg + 0.6, **kw), t=(sx * (gate_w / 2 + seg / 2 - 0.3), -OD / 2, 0))   # 外城南墙
    g.add(kit2.wall2(OD + 7, **kw), t=(-OW / 2, 0, 0), rot=-90)                           # 西墙
    g.add(kit2.wall2(OD + 7, **kw), t=(OW / 2, 0, 0), rot=90)                             # 东墙
    gate = kit.Geo()                                                                        # 震华门
    gate.add(kit2.gate_platform2(gate_w, 14, 7, 4.5, 6.0, batter=0.08))
    gate.add(kit2.hall2((3.8, 4.4, 3.8), (3.8, 3.8), col_h=4.0, front='door_center', back='windows', base_h=0.4,
                        base_mat='stone'), t=(0, 0.4, 7.06))
    g.add(gate, t=(0, -OD / 2, 0))
    for x in (-14, 14):                                                                    # 城区民居
        g.add(kit2.house2(12, 7, 4.0, gable='matou', steps=1, windows=2), t=(x, 4, 0))
    g.add(kit2.house2(9, 6, 3.6, gable='ying', windows=2, porch=True), t=(-14, -6, 0), rot=0)
    g.add(kit2.house2(9, 6, 3.6, gable='ying', windows=2), t=(14, -6, 0), rot=0)
    return g


from _common import run  # noqa: E402

run('X07', make, budget=110000)
