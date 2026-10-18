"""K07b_far（远景简模，v1） 民居群（北方）：三座灰瓦合院（四合院）组合，每座约 20×22——北房（正房，最高）、东西厢房、
南面倒座带门楼，院墙围合；屋顶为坡度较缓的硬山，山墙不做马头墙。保定府城内坊巷用。任务卡 K07b、概念图 K07b。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

UW, UD = 20.0, 22.0


def siheyuan():
    g = kit.Geo()
    g.add(kit.box(UW, UD, 0.12, 'stone'))
    g.add(kit.house(UW - 2, 6.5, 4.2, 2.0, gable='plain'), t=(0, UD / 2 - 3.6, 0))                 # 北房
    for sx in (-1, 1):                                                                              # 厢房
        g.add(kit.house(9, 4.6, 3.6, 1.6, gable='plain', door=False), t=(sx * (UW / 2 - 2.7), 0.2, 0), rot=sx * 90)
    g.add(kit.house(UW - 6, 4.4, 3.4, 1.5, gable='plain', windows=False, door=False), t=(1.8, -UD / 2 + 2.6, 0))  # 倒座
    g.add(kit.house(3.0, 4.6, 3.6, 1.4, gable='plain', windows=False), t=(-UW / 2 + 2.6, -UD / 2 + 2.6, 0))     # 门楼（东南/西南隅）
    # 院墙
    g.add(kit.enclosure(UW, UD, 3.0, thick=0.5, material='plaster', cap='tile'))
    return g


def make():
    g = kit.Geo()
    g.add(siheyuan(), t=(-11.5, 10.5, 0))
    g.add(siheyuan(), t=(11.5, 10.5, 0))
    g.add(siheyuan(), t=(-1.0, -13.0, 0))
    g.add(kit.box(46, 2.5, 0.1, 'stone', y=-1.3))  # 胡同
    return g


run('K07b_far', make, budget=12000)
