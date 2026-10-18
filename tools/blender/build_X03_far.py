"""X03_far（远景简模，v1） 夫人城：城墙西北隅外凸的方形「城外城」墩台 18×18×11，夯土外砌城砖，顶部四周垛口，墙面嵌石匾；
连接两段 20 米主城墙（L 形转角）。依据：规划文档「周长 70 余米，高 11 米，厚 18 米……东与襄阳城墙相连」；
实拍 夫人城墙.png；任务卡 X03。正面（-Y）为墩台南面。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402

S, H = 18.0, 11.0


def make():
    g = kit.Geo()
    # 主城墙：转角在原点，墙体分别向 +X、+Y 延伸，外侧朝 -Y、-X
    g.add(kit.wall_corner(24, 24, height=8, top_w=4.8, bottom_w=9.6))
    # 墩台：骑在转角上并向外突出
    c = -S / 2 + 4.0
    g.add(kit.platform(S, S, H, batter=0.05), t=(c, c, 0))
    ins = 0.05 * H
    g.add(kit.merlon_ring(S - 2 * ins, S - 2 * ins, H, front_h=1.6, back_h=1.6), t=(c, c, 0))
    # 南面石匾
    g.add(kit.box(5.0, 0.3, 1.6, 'marble', x=c, y=c - (S / 2 - 0.05 * 8.5) - 0.12, z=8.0))
    g.add(kit.box(4.2, 0.35, 1.0, 'void', x=c, y=c - (S / 2 - 0.05 * 8.5) - 0.16, z=8.3))
    return g


run('X03_far', make, budget=12000)
