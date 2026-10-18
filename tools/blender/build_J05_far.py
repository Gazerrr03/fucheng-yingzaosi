"""J05_far（远景简模，v1） 荆州洪武砖墙段：K01 城墙的变体，墙身更高、收分更明显，外侧墙面加几道砖缝腰线，
并散布若干块深色小砖面表示砖铭。依据：SM 洪武城砖刻辰州、沅州等提调与窑匠姓名；任务卡 J05。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

L, H, TOP, BOT = 40.0, 9.0, 4.8, 10.4


def make():
    g = kit.Geo()
    g.add(kit.wall(L, H, TOP, BOT))
    # 外侧墙面（-Y，收分）上的腰线与砖铭
    y_in = BOT / 2
    y_top = y_in - TOP
    def face_y(z):  # 外侧墙面在高度 z 处的 y
        return -y_in + (y_top + y_in) * z / H
    for z in (2.2, 4.6, 7.0):
        g.add(kit.box(L, 0.2, 0.18, 'brick_light', y=face_y(z) - 0.08, z=z))
    import random
    rng = random.Random(5)
    for _ in range(26):
        x = rng.uniform(-L / 2 + 1, L / 2 - 1)
        z = rng.uniform(0.8, H - 1.2)
        y = face_y(z) - 0.06
        g.face([(x - 0.35, y, z), (x + 0.35, y, z), (x + 0.35, y, z + 0.18), (x - 0.35, y, z + 0.18)], 'brick_dark')
    return g


run('J05_far', make, budget=6000)
