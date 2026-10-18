"""K14 关厢街屋（构件库 v2）：一排 6 间临街铺面，总长约 60、进深 9；每间独立硬山顶（隔间起马头墙），
铺面整间敞开（柜台、叠放的排门板、店内暗面），前檐退廊露出檐柱；檐下挂招幌与灯笼，前有街沿石。任务卡 K14。
远景简模见 build_K14_far.py。"""

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

N, UW, UD = 6, 9.8, 9.0


def shop(i):
    g = kit.Geo()
    g.add(kit2.house2(UW, UD, 4.0, roof_h=2.4, gable='matou' if i % 2 == 0 else 'ying', steps=1, door='shop', porch=True,
                      tile_pitch=0.44))
    y = -UD / 2 + 0.3
    g.add(kit.box(0.08, 0.08, 0.6, 'ink', x=UW / 2 - 1.4, y=y, z=3.6))                       # 招幌
    g.add(kit.box(0.7, 0.06, 1.8, 'qing' if i % 2 else 'vermilion', x=UW / 2 - 1.4, y=y, z=1.8))
    g.add(kit.box(0.76, 0.08, 0.1, 'gold', x=UW / 2 - 1.4, y=y, z=3.6))
    g.add(kit2.lantern(drop=0.3), t=(-UW / 2 + 1.6, y, 4.0))
    return g


def make():
    g = kit.Geo()
    for i in range(N):
        g.add(shop(i), t=(-(N - 1) * UW / 2 + i * UW, 0.3 * ((i * 7) % 3 - 1), 0))
    g.add(kit.box(N * UW + 2, 3.0, 0.1, 'stone', y=-UD / 2 - 1.8))
    return g

from _common import run  # noqa: E402

run('K14', make, budget=90000)
