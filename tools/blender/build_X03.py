"""X03 夫人城（构件库 v2）：城墙西北隅外凸的方形「城外城」墩台 18×18×11——石条基、砖砌收分台身、腰线、
四周垛口（望孔、射孔）、吐水嘴、南面石匾；连接两段 24 米主城墙 v2（L 形转角），城内一侧马道。
依据：规划文档「周长 70 余米，高 11 米，厚 18 米……东与襄阳城墙相连」；实拍 夫人城墙.png；任务卡 X03。
正面（-Y）为墩台南面。远景简模见 build_X03_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

S, H = 18.0, 11.0


def make():
    g = kit.Geo()
    # 主城墙：转角在原点，墙体分别向 +X、+Y 延伸，外侧朝 -Y、-X
    g.add(kit2.wall_corner2(24, 24, height=8, top_w=4.8, bottom_w=9.6))
    c = -S / 2 + 4.0
    g.add(kit2.gate_platform2(S, S, H, None, None, batter=0.05), t=(c, c, 0))
    g.add(kit2.banner(), t=(c - S / 2 + 2.0, c - S / 2 + 2.0, H + 0.06))
    g.add(kit2.banner(color='qing'), t=(c + S / 2 - 2.0, c - S / 2 + 2.0, H + 0.06))
    g.add(kit2.ramp(16, 7.8, 3.0), t=(14.0, 7.8, 0))
    return g


from _common import run  # noqa: E402

run('X03', make, budget=60000)
