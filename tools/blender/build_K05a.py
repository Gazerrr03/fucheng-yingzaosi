"""K05a 方形瓮城（构件库 v2）：主城台 26×18×8（拱券门洞、门扇、门额匾、垛口）+ 三开间单檐歇山城楼 +
两侧城墙 v2；城门外（-Y）方形瓮城 40×35，墙高 7（城墙 v2：石基、垛口、宇墙、吐水嘴），瓮城门开在东墙
（屈曲开门），门上小箭楼；瓮城内石板地面。任务卡 K05a；远景简模见 build_K05a_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

GW, GD, GH = 26.0, 18.0, 8.0          # 主城台
BW, BD, BH = 40.0, 35.0, 7.0          # 瓮城（后边贴在主城墙外皮 y≈-3）
Y0 = -3.0


def make():
    g = kit.Geo()
    g.add(kit2.gate_platform2(GW, GD, GH, 5.0, 7.0, batter=0.08))
    g.add(kit2.hall2((4.2, 4.8, 4.2), (4.2, 4.2), col_h=4.4, front='door_center', back='windows', base_h=0.45,
                     base_mat='stone'), t=(0, 0.6, GH + 0.06))
    for sx in (-1, 1):
        g.add(kit2.wall2(12, GH, 4.8, 9.6), t=(sx * (GW / 2 + 6 - 0.6), 1.5, 0))
    bar, (gx, gy), rot = kit2.barbican_square(BW, BD, BH, gate_w=7.0)
    g.add(bar, t=(0, Y0, 0))
    g.add(kit2.small_gate(8.0, 7.5, BH, 3.5, 5.0, bays=(3.8,), bays_y=(3.4,), col_h=3.6), t=(gx, gy + Y0, 0), rot=rot)
    g.add(kit2.banner(), t=(-BW / 2 + 1.0, Y0 - BD + 1.0, BH))
    return g


from _common import run  # noqa: E402

run('K05a', make, budget=110000)
