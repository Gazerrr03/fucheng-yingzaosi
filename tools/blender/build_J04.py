"""J04 荆州南纪门（曲江楼）（构件库 v2）：主城台 + 两层城楼（腰檐平座、歇山顶）；城外同一轴线上另有一座箭楼城台
（三开间单檐小楼），两台之间以瓮城墙 v2 相连，瓮城两侧各开侧门（门上小楼），通道呈十字形。依据：网络资料
「主城台与箭楼城台在同一轴线上，两侧开侧门，通道十字形」（只作外观参考）；SM「南纪门，楼曰曲江」；任务卡 J04。
远景简模见 build_J04_far.py。"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

GW, GD, GH = 26.0, 18.0, 9.0


def make():
    g = kit.Geo()
    g.add(kit2.gate_platform2(GW, GD, GH, 5.0, 7.0, batter=0.08))
    g.add(kit2.hall2((3.8, 4.4, 3.8), (3.6, 3.6), col_h=4.0, front='doors', back='windows', base_h=0.45,
                     base_mat='stone', stories=2, shrink=0.88), t=(0, 0.6, GH + 0.06))
    for sx in (-1, 1):
        g.add(kit2.wall2(12, GH, 4.8, 9.6), t=(sx * (GW / 2 + 6 - 0.6), 1.5, 0))
    fy = -GD / 2 - 30
    g.add(kit2.gate_platform2(16, 12, 8, 4.0, 5.8, batter=0.06), t=(0, fy, 0))
    g.add(kit2.hall2((3.4, 3.8, 3.4), (3.2, 3.2), col_h=3.6, front='door_center', back='windows', base_h=0.3,
                     lanterns=False, beasts=2), t=(0, fy + 0.3, 8.06))
    kw = dict(height=7, top_w=3.6, bottom_w=5.6)
    span = 30 - 6
    for sx in (-1, 1):
        x = sx * 9.0
        for sy in (-1, 1):
            g.add(kit2.wall2(span / 2 - 4.4, **kw), t=(x, -GD / 2 - 15 + sy * (span / 4 + 2.2), 0), rot=sx * 90)
        g.add(kit2.small_gate(10, 9, 7, 3.4, 5.0, bays=(3.8,), bays_y=(3.2,), col_h=3.4), t=(x, -GD / 2 - 15, 0), rot=sx * 90)
    g.add(kit.box(14, 24, 0.1, 'stone', y=-GD / 2 - 15))
    return g

from _common import run  # noqa: E402

run('J04', make, budget=150000)
