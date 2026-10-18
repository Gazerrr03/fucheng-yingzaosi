"""K05b 半圆形瓮城（构件库 v2）：主城台 26×18×8 + 三开间单檐歇山城楼 + 两侧城墙 v2；城外（-Y）
半径 20 的半圆瓮城（12 段城墙 v2 拼成），东侧弧墙上开瓮城门，门上小箭楼。任务卡 K05b；
远景简模见 build_K05b_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

GW, GD, GH = 26.0, 18.0, 8.0
R, BH, N = 20.0, 7.0, 12
CY = -4.0                              # 半圆圆心（主城墙外皮附近）
GATE_K = 2                             # 东侧第 3 段开门


def make():
    g = kit.Geo()
    g.add(kit2.gate_platform2(GW, GD, GH, 5.0, 7.0, batter=0.08))
    g.add(kit2.hall2((4.2, 4.8, 4.2), (4.2, 4.2), col_h=4.4, front='door_center', back='windows', base_h=0.45,
                     base_mat='stone'), t=(0, 0.6, GH + 0.06))
    for sx in (-1, 1):
        g.add(kit2.wall2(12, GH, 4.8, 9.6), t=(sx * (GW / 2 + 6 - 0.6), 1.5, 0))
    seg_len = 2 * R * math.sin(math.pi / (2 * N)) + 0.8
    for k in range(N):
        th = math.pi + (k + 0.5) * math.pi / N          # π..2π：城外半圆
        rot = math.degrees(math.atan2(math.cos(th), -math.sin(th)))   # 外侧（局部 -Y）朝径向外
        pos = (R * math.cos(th), CY + R * math.sin(th), 0)
        if k == N - 1 - GATE_K:
            g.add(kit2.small_gate(seg_len + 1.6, 7.5, BH, 3.5, 5.0, bays=(3.8,), bays_y=(3.4,), col_h=3.6), t=pos, rot=rot)
        else:
            g.add(kit2.wall2(seg_len, BH, 3.6, 6.0), t=pos, rot=rot)
    g.add(kit.cyl(R - 3.0, 0.08, 'stone', y=CY, seg=24), t=(0, 0, 0))
    return g


from _common import run  # noqa: E402

run('K05b', make, budget=110000)
