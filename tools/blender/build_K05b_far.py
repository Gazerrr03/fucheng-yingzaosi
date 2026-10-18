"""K05b_far（远景简模，v1） 半圆形瓮城：主城台 + 单檐城楼（同 K04a 形制）；城外（-Y）一道直径 40 的半圆瓮城墙，
墙高 7、顶带垛口，瓮城门开在东侧弧墙上。任务卡 K05b。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

GW, GD, GH = 26, 18, 8
R, BH, N = 20.0, 7.0, 12


def make():
    g = kit.Geo()
    g.add(kit.platform(GW, GD, GH, batter=0.08, arch=(5, 7), arch_ring=0.7))
    g.add(kit.merlon_ring(GW - 1.3, GD - 1.3, GH))
    g.add(kit.hall(3, 4.6, 2, 4.3, 4.5, roof_kind='xieshan', infill='plaster', door_center=True,
                   base_mat='brick_light', base_h=0.5, overhang=2.0), t=(0, 0, GH))
    for sx in (-1, 1):
        g.add(kit.wall(12, GH, 4.8, 9.6), t=(sx * (GW / 2 + 6 - 0.6), 1.5, 0))
    cy = -GD / 2 + 1.0
    seg_len = 2 * R * math.sin(math.pi / (2 * N)) + 0.6
    gate_k = 2  # 东侧第 3 段开门
    for k in range(N):
        th = math.pi + (k + 0.5) * math.pi / N          # π..2π：城外半圆
        if k == N - 1 - gate_k:
            continue
        x, y = R * math.cos(th), cy + R * math.sin(th)
        rot = math.degrees(math.atan2(math.cos(th), -math.sin(th)))  # 外侧（局部 -Y）朝径向外
        g.add(kit.wall(seg_len, BH, 4.0, 6.0), t=(x, y, 0), rot=rot)
    # 瓮城门
    th = math.pi + (N - 1 - gate_k + 0.5) * math.pi / N
    rot = math.degrees(math.atan2(math.cos(th), -math.sin(th)))
    gate = kit.Geo()
    gate.add(kit.platform(seg_len + 1.0, 7.0, BH, batter=0.06, arch=(3.5, 5.0), arch_ring=0.5))
    gate.add(kit.hall(1, 4.4, 1, 4.0, 3.2, roof_kind='xieshan', base_mat='brick_light', base_h=0.3, overhang=1.2), t=(0, 0, BH))
    g.add(gate, t=(R * math.cos(th), cy + R * math.sin(th), 0), rot=rot)
    return g


run('K05b_far', make, budget=25000)
