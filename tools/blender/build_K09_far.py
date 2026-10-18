"""K09_far（远景简模，v1） 坛：方形夯土坛台 15×15×1.5（石压边），四面正中出陛；外围壝墙 35×35，高 1.2、厚 0.6，四面正中开门。任务卡 K09。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401



def make():
    g = kit.Geo()
    g.add(kit.box(15, 15, 1.5, 'earth', taper=0.1, top_mat='earth'))
    g.add(kit.box(15.4, 15.4, 0.3, 'stone', z=1.35, taper=0.2, top_mat='earth'))  # 石压边，顶面仍是夯土
    for rot in (0, 90, 180, 270):  # 四出陛
        stair = kit.Geo()
        stair.add(kit.stair(3.4, 2.4, 1.5), t=(0, -7.5 - 1.2, 0))
        g.add(stair, rot=rot)
    g.add(kit.enclosure(35, 35, 1.2, thick=0.6, gates=[(s, 0, 3) for s in 'SNEW'], material='earth', cap='stone'))
    return g


run('K09_far', make, budget=3000)
