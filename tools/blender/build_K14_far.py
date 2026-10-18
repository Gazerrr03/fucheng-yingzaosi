"""K14_far（远景简模，v1） 关厢街屋：一排 6 间临街铺面，总长 60、进深 10、檐高 4；每间独立硬山顶，间与间之间起小马头墙，
铺面开敞（暗面表示店内），前有一面坡披檐与朱红檐柱。任务卡 K14。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402

N, UW, UD = 6, 9.8, 9.0


def shop(i):
    g = kit.Geo()
    g.add(kit.house(UW, UD, 4.0, 2.2, gable='matou' if i % 2 == 0 else 'plain', steps=1, door=False, windows=False))
    # 敞开的铺面
    y = -UD / 2 - 0.04
    g.face([(-UW / 2 + 0.8, y, 0.7), (UW / 2 - 0.8, y, 0.7), (UW / 2 - 0.8, y, 3.3), (-UW / 2 + 0.8, y, 3.3)], 'void')
    for x in (-UW / 2 + 0.8, -1.2, 1.2, UW / 2 - 0.8):  # 门板 / 立柱
        g.add(kit.box(0.35, 0.2, 2.6, 'vermilion', x=x, y=y - 0.05, z=0.7))
    g.add(kit.porch(UW - 0.2, depth=2.2, h=3.7, posts=2), t=(0, -UD / 2, 0))
    return g


def make():
    g = kit.Geo()
    for i in range(N):
        g.add(shop(i), t=(-(N - 1) * UW / 2 + i * UW, 0.3 * ((i * 7) % 3 - 1), 0))
    g.add(kit.box(N * UW + 2, 3.0, 0.1, 'stone', y=-UD / 2 - 1.6))  # 街沿石
    return g


run('K14_far', make, budget=10000)
