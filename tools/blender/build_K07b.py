"""K07b 民居群（北方，构件库 v2）：三座灰瓦合院（四合院），每座约 20×22——北房（正房，最高）、东西厢房、
南面倒座、东南 / 西南隅门楼，青砖院墙瓦帽；房屋为坡度较缓的硬山（青砖山墙、筒瓦、望兽），不做马头墙。
保定府城内坊巷用。任务卡 K07b、概念图 K07b。
远景简模见 build_K07b_far.py。"""

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

UW, UD = 20.0, 22.0


def siheyuan():
    g = kit.Geo()
    g.add(kit.box(UW, UD, 0.12, 'stone'))
    g.add(kit2.enclosure2(UW, UD, 3.0, thick=0.5, gates=[('S', -UW / 2 + 2.6, 2.2)], material='brick'))
    common = dict(gable='ying', wall_mat='brick', tile_pitch=0.44)
    g.add(kit2.house2(UW - 2.4, 6.4, 4.0, roof_h=2.0, windows=2, porch=True, **common), t=(0, UD / 2 - 3.7, 0))   # 北房
    for sx in (-1, 1):                                                                                          # 厢房
        g.add(kit2.house2(8.6, 4.4, 3.4, roof_h=1.5, windows=2, **common), t=(sx * (UW / 2 - 2.7), 0.2, 0), rot=-90 * sx)
    g.add(kit2.house2(UW - 6.4, 4.2, 3.2, roof_h=1.4, door=None, windows=2, **common),
          t=(1.8, -UD / 2 + 2.5, 0), rot=180)                                                                   # 倒座（门窗朝院内）
    g.add(kit2.house2(3.0, 4.4, 3.4, roof_h=1.3, door='center', windows=0, **common), t=(-UW / 2 + 2.6, -UD / 2 + 2.4, 0))  # 门楼
    return g


def make():
    g = kit.Geo()
    g.add(siheyuan(), t=(-11.5, 10.5, 0))
    g.add(siheyuan(), t=(11.5, 10.5, 0))
    g.add(siheyuan(), t=(-1.0, -13.0, 0))
    g.add(kit.box(46, 2.5, 0.1, 'stone', y=-1.3))
    return g

from _common import run  # noqa: E402

run('K07b', make, budget=120000)
