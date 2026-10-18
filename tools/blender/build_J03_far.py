"""J03_far（远景简模，v1） 荆州公安门（水门）：城墙一侧接一座方形城台（城楼已不存，只做城台），城外为半圆形瓮城，
瓮城门开在弧墙正中，门外石阶下到内河码头。依据：SM「公安门旧名楚望」、城外掘池通诸水；任务卡 J03、概念图 J03_v2。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

R, BH, N = 18.0, 6.5, 12


def make():
    g = kit.Geo()
    g.add(kit.wall(44, 8, 4.8, 9.6), t=(-4, 2.0, 0))                          # 主城墙
    g.add(kit.platform(14, 14, 9.5, batter=0.06), t=(18, 0, 0))                 # 城台（城楼已不存）
    g.add(kit.merlon_ring(12.9, 12.9, 9.5, front_h=1.6, back_h=1.6), t=(18, 0, 0))
    g.add(kit.platform(10, 10, 8, batter=0.06, arch=(4.5, 6.5), arch_ring=0.6), t=(0, -1.0, 0))  # 主门
    cy = -3.0
    seg_len = 2 * R * math.sin(math.pi / (2 * N)) + 0.6
    gate_k = N // 2
    for k in range(N):
        if k in (gate_k - 1, gate_k):
            continue
        th = math.pi + (k + 0.5) * math.pi / N
        rot = math.degrees(math.atan2(math.cos(th), -math.sin(th)))
        g.add(kit.wall(seg_len, BH, 3.6, 5.6), t=(R * math.cos(th), cy + R * math.sin(th), 0), rot=rot)
    # 弧墙正中的门（朝南）+ 门外石阶 + 码头
    g.add(kit.platform(2 * seg_len + 1.0, 6.5, BH, batter=0.06, arch=(3.4, 4.8), arch_ring=0.5), t=(0, cy - R, 0))
    g.add(kit.stair(5.0, 4.0, 1.2), t=(0, cy - R - 5.2, 0))          # 门外石阶
    g.add(kit.box(14, 6, 0.4, 'stone', y=cy - R - 10.0))                # 码头
    g.add(kit.box(2 * R - 6, R - 3, 0.12, 'stone', y=cy - R / 2))
    return g


run('J03_far', make, budget=25000)
