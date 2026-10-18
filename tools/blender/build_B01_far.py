"""B01_far（远景简模，v1） 保定府署：坐北朝南的长条形院落约 36×120，中轴五进——大门、仪门、大堂（五开间歇山，台基 1.2）、
二堂、官邸，各进之间东西厢房；外围粉墙。依据：府城资料「府署位置：城正中」；直隶总督署的五进院落格局
只作院落形制参考（任务卡 B01，概念图 B01_v2）。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

W, D = 36.0, 120.0


def make():
    g = kit.Geo()
    g.add(kit.enclosure(W, D, 3.4, thick=0.6, gates=[('S', 0, 12)], material='plaster', cap='tile'))
    g.add(kit.box(W - 2, D - 2, 0.12, 'stone'))
    halls = [  # (y, 开间, 间宽, 进深间, 间深, 柱高, 屋顶, 台基)
        (-D / 2, 3, 4.0, 1, 6.5, 4.0, 'yingshan', 0.6),       # 大门
        (-34, 3, 3.6, 1, 5.5, 3.8, 'yingshan', 0.5),          # 仪门
        (-8, 5, 4.0, 3, 4.0, 5.0, 'xieshan', 1.2),            # 大堂
        (18, 5, 3.8, 2, 4.5, 4.4, 'yingshan', 0.8),           # 二堂
        (42, 5, 3.6, 2, 4.5, 4.2, 'yingshan', 0.6),           # 官邸
    ]
    for y, bx, bw, by, bd, ch, kind, bh in halls:
        g.add(kit.hall(bx, bw, by, bd, ch, roof_kind=kind, door_center=True, base_h=bh, overhang=1.4 if kind == 'xieshan' else 1.0), t=(0, y, 0))
    for y in (-21, 5, 30, 52):  # 厢房
        for sx in (-1, 1):
            g.add(kit.hall(3, 3.6, 1, 5.0, 3.5, roof_kind='yingshan', overhang=0.8), t=(sx * (W / 2 - 4.0), y, 0), rot=90)
    for y in (-28, 0, 24):  # 隔墙（每进之间，正中开门）：左右两段，中间留 5 米
        seg = (W - 1.2 - 5) / 2
        for sx in (-1, 1):
            g.add(kit.box(seg, 0.5, 3.0, 'plaster', x=sx * (2.5 + seg / 2), y=y))
            g.add(kit.box(seg + 0.1, 0.9, 0.3, 'tile', x=sx * (2.5 + seg / 2), y=y, z=3.0))
    return g


run('B01_far', make, budget=35000)
