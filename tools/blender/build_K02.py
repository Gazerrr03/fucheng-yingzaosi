"""K02 城墙转角 + 角台（构件库 v2）：两段城墙 v2 呈直角相接（沿 +X、+Y），转角外侧凸出一座方形角台 14×14×9
（石条基、腰线、垛口、吐水嘴），台顶牙旗。用于荆州东城墙弯折处、保定靴城凸出部。
远景简模见 build_K02_far.py。"""

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
    g.add(kit2.wall_corner2(26, 26, height=8, top_w=4.8, bottom_w=9.6))
    c = -3.0
    g.add(kit2.gate_platform2(14, 14, 9, None, None, batter=0.06, tablet=False), t=(c, c, 0))
    g.add(kit2.banner(), t=(c - 4.5, c - 4.5, 9.06))
    return g

from _common import run  # noqa: E402

run('K02', make, budget=15000)
