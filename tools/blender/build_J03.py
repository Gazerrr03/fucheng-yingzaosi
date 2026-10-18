"""J03 荆州公安门（水门）（构件库 v2）：城墙 v2 一侧接一座方形城台（城楼已不存，只做城台：石条基、腰线、垛口、
石匾），主门小城台（拱券门洞、门扇门钉）；城外半圆形瓮城（城墙 v2 拼成），瓮城门开在弧墙正中，门外石阶下到
内河码头（条石驳岸、系缆石）。依据：SM「公安门旧名楚望」、城外掘池通诸水；任务卡 J03、概念图 J03_v2。
远景简模见 build_J03_far.py。"""

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

R, BH, N = 18.0, 6.5, 12


def make():
    g = kit.Geo()
    g.add(kit2.wall2(44, 8, 4.8, 9.6), t=(-4, 2.0, 0))
    g.add(kit2.gate_platform2(14, 14, 9.5, None, None, batter=0.06), t=(18, 0, 0))
    g.add(kit2.gate_platform2(10, 10, 8, 4.5, 6.5, batter=0.06, tablet=False), t=(0, -1.0, 0))
    cy = -3.0
    seg_len = 2 * R * math.sin(math.pi / (2 * N)) + 0.8
    gate_k = N // 2
    for k in range(N):
        if k in (gate_k - 1, gate_k):
            continue
        th = math.pi + (k + 0.5) * math.pi / N
        rot = math.degrees(math.atan2(math.cos(th), -math.sin(th)))
        g.add(kit2.wall2(seg_len, BH, 3.6, 5.6), t=(R * math.cos(th), cy + R * math.sin(th), 0), rot=rot)
    g.add(kit2.gate_platform2(2 * seg_len + 1.0, 6.5, BH, 3.4, 4.8, batter=0.06), t=(0, cy - R, 0))
    g.add(kit.stair(5.0, 4.0, 1.2), t=(0, cy - R - 5.3, 0))
    dock = kit.Geo()                                                                        # 码头
    dock.add(kit.box(14, 6, 0.45, 'stone'))
    for x in [-6.5 + k * 1.3 for k in range(11)]:
        dock.add(kit.box(0.05, 6.0, 0.03, 'marble', x=x, z=0.45))
    for x in (-5.5, 0.0, 5.5):
        dock.add(kit.cyl(0.25, 0.7, 'stone', x=x, y=-2.6, z=0.45, seg=8))
    g.add(dock, t=(0, cy - R - 10.0, 0))
    g.add(kit.box(2 * R - 7, R - 4, 0.1, 'stone', y=cy - R / 2))
    return g

from _common import run  # noqa: E402

run('J03', make, budget=90000)
