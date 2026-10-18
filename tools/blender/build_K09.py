"""K09 坛（构件库 v2）：方形夯土坛台 15×15×1.5，石条压边、坛面方砖；四面正中出陛（汉白玉垂带踏跺）；
外围壝墙 35×35（砖下碱、红墙、瓦帽），四面正中开门，门两侧石墩。任务卡 K09。
远景简模见 build_K09_far.py。"""

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

def make():
    g = kit.Geo()
    g.add(kit.box(15, 15, 1.5, 'earth', taper=0.1, top_mat='earth'))
    g.add(kit.box(15.4, 15.4, 0.3, 'stone', z=1.3, taper=0.15))
    g.add(kit.box(14.6, 14.6, 0.05, 'brick_light', z=1.6))
    for i in range(4):                                                                      # 压边条石分缝
        for k in range(10):
            x = -7.7 + (k + 1) * 15.4 / 11
            piece = kit.box(0.05, 0.4, 0.05, 'marble', x=x, y=-7.5, z=1.58)
            g.add(piece, rot=90 * i)
    for rot in (0, 90, 180, 270):                                                           # 四出陛
        st = kit.Geo()
        st.add(kit.stair(3.4, 2.6, 1.55), t=(0, -7.5 - 1.3, 0))
        for sx in (-1, 1):
            st.add(kit.extrude_xz([(0, 0), (2.6, 0), (0, 1.65)], 0.4, 'marble'), t=(sx * 1.9, -7.5, 0), rot=90)
        g.add(st, rot=rot)
    g.add(kit2.enclosure2(35, 35, 1.8, thick=0.6, gates=[(s, 0, 3) for s in 'SNEW'], material='vermilion'))
    for rot in (0, 90, 180, 270):
        gp = kit.Geo()
        for sx in (-1, 1):
            gp.add(kit.box(0.8, 0.9, 2.2, 'stone', x=sx * 1.9, y=-17.5))
            gp.add(kit.cyl(0.32, 0.35, 'stone', x=sx * 1.9, y=-17.5, z=2.2, seg=8, r_top=0.15))
        g.add(gp, rot=rot)
    return g

from _common import run  # noqa: E402

run('K09', make, budget=20000)
