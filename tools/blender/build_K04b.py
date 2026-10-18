"""K04b 城门台 + 重檐城楼（构件库 v2）：城台 36×22×8，拱券门洞 6×7.5；台上五开间两层城楼
（面阔约 21、进深约 9），底层隔扇门、二层平座栏杆，腰檐 + 歇山顶；城楼台明汉白玉栏杆、前出踏跺；
两侧各接 10 米城墙 v2，城内马道。任务卡 K04b；远景简模见 build_K04b_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

W, D, H, BATTER = 36.0, 22.0, 8.0, 0.08


def make():
    g = kit.Geo()
    g.add(kit2.gate_platform2(W, D, H, 6.0, 7.5, batter=BATTER))
    ins = BATTER * H
    tw, td = W - 2 * ins, D - 2 * ins
    bx = (4.0, 4.0, 4.8, 4.0, 4.0)
    by = (4.4, 4.4)
    g.add(kit2.hall2(bx, by, col_h=4.8, front='doors', back='windows', base_h=0.8, base_mat='marble',
                     stories=2, shrink=0.9, front_steps=True, beasts=5), t=(0, 0.8, H + 0.06))
    g.add(kit2.railing_ring(sum(bx) + 2.5, sum(by) + 2.5, H + 0.86, gap_front=4.6, material='marble', post_gap=1.4),
          t=(0, 0.8, 0))
    for sx in (-1, 1):
        g.add(kit2.wall2(10, H, 4.8, 9.6), t=(sx * (W / 2 + 5 - 0.6), 1.5, 0))
        for k in (0, 1):
            g.add(kit2.banner(), t=(sx * (tw / 2 - 1.2 - k * 3.0), -td / 2 + 1.4, H + 0.06))
    g.add(kit2.ramp(16, H - 0.2, 3.2), t=(5.0, D / 2 + 1.7, 0))
    return g


from _common import run  # noqa: E402

run('K04b', make, budget=110000)
