"""K07a_far（远景简模，v1） 民居群（南方）：4 户合为一组，约 40×40；每户为硬山小院（前屋 + 天井 + 正屋 + 院墙），
山墙做马头墙，粉墙灰瓦灰砖墙基；四户 2×2 排布，中间十字巷。见任务卡 K07a。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402

UNIT = 18.0   # 每户院落边长
LANE = 2.5    # 巷宽


def courtyard(seed):
    """一户（按概念图）：后部正屋（最高）+ 左右厢房 + 前院墙带门楼，围出天井。正面朝 -Y。"""
    g = kit.Geo()
    w = UNIT - 1.0
    # 正屋：通面阔，靠北
    g.add(kit.house(w, 6.5, 4.8, 2.8, gable='matou', steps=2), t=(0, UNIT / 2 - 3.6, 0))
    # 厢房：东西两侧，山墙朝南北
    wing_len = UNIT - 8.0
    for sx in (-1, 1):
        g.add(kit.house(wing_len, 4.2, 3.8, 2.0, gable='matou', steps=1, door=False), t=(sx * (w / 2 - 2.2), -1.6, 0), rot=90)
    # 前院墙 + 门楼（明间开门）
    front_y = -UNIT / 2 + 0.6
    for sx in (-1, 1):
        seg = kit.Geo()
        seg.add(kit.box(w / 2 - 1.6, 0.45, 3.6, 'plaster'))
        seg.add(kit.box(w / 2 - 1.4, 0.85, 0.3, 'tile', z=3.6))
        seg.add(kit.box(w / 2 - 1.6, 0.5, 0.7, 'brick_dark'))
        g.add(seg, t=(sx * (w / 4 + 0.8), front_y, 0))
    g.add(kit.house(3.2, 2.0, 3.6, 1.2, gable='plain', windows=False), t=(0, front_y, 0))
    # 天井地面（青石）
    g.add(kit.box(w - 9.0, UNIT - 10.0, 0.15, 'stone', y=-1.4))
    return g


def make():
    g = kit.Geo()
    off = UNIT / 2 + LANE / 2
    for i, (x, y) in enumerate([(-off, -off), (off, -off), (-off, off), (off, off)]):
        # 南排两户正面朝南，北排两户也朝南（坐北朝南），略错位避免死板
        g.add(courtyard(i), t=(x + (0.6 if i % 2 else -0.6), y + (0.4 if i > 1 else 0), 0))
    # 十字巷石板
    g.add(kit.box(2 * UNIT + LANE + 2, LANE, 0.1, 'stone'))
    g.add(kit.box(LANE, 2 * UNIT + LANE + 2, 0.1, 'stone'))
    return g


run('K07a_far', make, budget=12000)
