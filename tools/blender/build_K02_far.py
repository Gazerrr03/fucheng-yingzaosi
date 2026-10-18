"""K02_far（远景简模，v1） 城墙转角 + 角台：两段城墙呈直角相接（沿 +X、+Y），转角外侧凸出一座方形角台，顶带垛口。
任务卡见 3D建模指南 K02；用于荆州东城墙弯折处、保定靴城凸出部。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402


def make():
    g = kit.Geo()
    g.add(kit.wall_corner(26, 26, height=8, top_w=4.8, bottom_w=9.6))
    c = -3.0
    g.add(kit.platform(14, 14, 9, batter=0.06), t=(c, c, 0))
    g.add(kit.merlon_ring(12.9, 12.9, 9, front_h=1.6, back_h=1.6), t=(c, c, 0))
    return g


run('K02_far', make, budget=8000)
