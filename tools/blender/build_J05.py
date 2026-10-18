"""J05 荆州洪武砖墙段（构件库 v2）：城墙 v2 的变体，墙身更高（9 米）、收分更明显，外侧墙面加三道砖线腰线，
并散布若干块深色铭文砖。依据：SM 洪武城砖刻辰州、沅州等提调与窑匠姓名；任务卡 J05。
远景简模见 build_J05_far.py。"""

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

L, H, TOP, BOT = 40.0, 9.0, 4.8, 10.4


def make():
    g = kit.Geo()
    g.add(kit2.wall2(L, H, TOP, BOT))
    y_in = BOT / 2
    y_top = y_in - TOP

    def face_y(z):
        return -y_in + (y_top + y_in) * z / H

    for z in (2.2, 6.0):
        g.add(kit.box(L, 0.24, 0.16, 'brick_light', y=face_y(z) - 0.08, z=z))
    rng = random.Random(5)
    for _ in range(30):
        x = rng.uniform(-L / 2 + 1, L / 2 - 1)
        z = rng.uniform(1.4, H - 1.4)
        g.add(kit.box(0.46, 0.08, 0.14, 'brick_dark', x=x, y=face_y(z) - 0.03, z=z))
    return g

from _common import run  # noqa: E402

run('J05', make, budget=12000)
