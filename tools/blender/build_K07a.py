"""K07a 民居群（南方，构件库 v2）：4 户合为一组，约 40×40；每户为硬山小院——正屋（通面阔、马头墙两级）、
东西厢房（马头墙一级）、前院墙带门楼（悬山小顶、实榻门），围出青石天井；粉墙灰瓦灰砖墙裙，四户 2×2 排布，
中间十字巷石板路。任务卡 K07a。
远景简模见 build_K07a_far.py。"""

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

UNIT = 18.0   # 每户院落边长
LANE = 2.5    # 巷宽


def gatehouse():
    g = kit.Geo()
    for sx in (-1, 1):
        g.add(kit.box(0.9, 1.4, 3.4, 'brick', x=sx * 1.45))
    g.add(kit.box(2.0, 0.24, 2.6, 'vermilion', y=0.05))
    g.add(kit.box(2.4, 0.4, 0.3, 'wood', z=2.6))
    g.add(kit.box(3.4, 1.0, 0.4, 'brick_light', z=3.0))
    g.add(kit2.roof_gable2(3.6, 1.4, h=0.7, overhang=0.4, gable='xuan', beasts=False), t=(0, 0, 3.4))
    return g


def courtyard(seed):
    g = kit.Geo()
    w = UNIT - 1.0
    g.add(kit2.enclosure2(UNIT - 0.4, UNIT - 0.4, 3.6, thick=0.45, gates=[('S', 0, 2.2)]))
    g.add(kit2.house2(w - 1.0, 6.4, 4.8, gable='matou', steps=2, windows=2), t=(0, UNIT / 2 - 3.9, 0))
    wing_len = UNIT - 9.0
    for sx in (-1, 1):
        g.add(kit2.house2(wing_len, 4.0, 3.8, gable='matou', steps=1, windows=2),
              t=(sx * (w / 2 - 2.4), -1.4, 0), rot=-90 * sx)
    g.add(gatehouse(), t=(0, -UNIT / 2 + 0.2, 0))
    g.add(kit.box(w - 10.0, UNIT - 11.0, 0.14, 'stone', y=-2.0))                     # 天井
    rng = random.Random(seed)
    g.add(kit.cyl(0.5, 0.7, 'stone', x=rng.choice((-2.2, 2.2)), y=-4.5, seg=10))        # 水缸
    return g


def make():
    g = kit.Geo()
    off = UNIT / 2 + LANE / 2
    for i, (x, y) in enumerate([(-off, -off), (off, -off), (-off, off), (off, off)]):
        g.add(courtyard(i), t=(x + (0.6 if i % 2 else -0.6), y + (0.4 if i > 1 else 0), 0))
    g.add(kit.box(2 * UNIT + LANE + 2, LANE, 0.1, 'stone'))
    g.add(kit.box(LANE, 2 * UNIT + LANE + 2, 0.1, 'stone'))
    return g

from _common import run  # noqa: E402

run('K07a', make, budget=120000)
