"""B01 保定府署（构件库 v2）：坐北朝南的长条形院落约 36×120，粉墙瓦帽；中轴五进——大门、仪门（三开间硬山小式）、
大堂（五开间单檐歇山，斗栱、隔扇门，台基 1.2、前出踏跺）、二堂、官邸（五开间硬山），各进之间东西厢房，
每进之间隔墙正中开门。依据：府城资料「府署位置：城正中」；直隶总督署的五进院落格局只作院落形制参考
（任务卡 B01，概念图 B01_v2）。
远景简模见 build_B01_far.py。"""

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

W, D = 36.0, 120.0


def make():
    g = kit.Geo()
    g.add(kit2.enclosure2(W, D, 3.4, thick=0.6, gates=[('S', 0, 12)], material='plaster'))
    g.add(kit.box(W - 1.4, D - 1.4, 0.12, 'stone'))
    g.add(kit.box(4.0, D - 6, 0.06, 'brick_light', z=0.12))
    small = dict(dougong=False, lanterns=False, beasts=0, roof_kind='ying')
    g.add(kit2.hall2((3.6, 4.4, 3.6), (3.2, 3.2), col_h=3.8, front='door_center', back='open', base_h=0.6, **small),
          t=(0, -D / 2 + 1.4, 0.12))                                                                 # 大门
    g.add(kit2.hall2((3.4, 4.0, 3.4), (2.6, 2.6), col_h=3.6, front='door_center', back='open', base_h=0.5, **small),
          t=(0, -34, 0.12))                                                                           # 仪门
    g.add(kit2.hall2((3.8, 3.8, 4.4, 3.8, 3.8), (4.0, 4.0, 4.0), col_h=4.8, front='doors', back='windows', base_h=1.2,
                     front_steps=True, beasts=3), t=(0, -8, 0.12))                                    # 大堂
    g.add(kit2.hall2((3.6, 3.6, 4.2, 3.6, 3.6), (4.4, 4.4), col_h=4.2, front='door_center', back='windows', base_h=0.8,
                     **small), t=(0, 18, 0.12))                                                       # 二堂
    g.add(kit2.hall2((3.4, 3.4, 4.0, 3.4, 3.4), (4.4, 4.4), col_h=4.0, front='door_center', back='windows', base_h=0.6,
                     **small), t=(0, 42, 0.12))                                                       # 官邸
    for y in (-21, 5, 30, 52):                                                                        # 厢房
        for sx in (-1, 1):
            g.add(kit2.hall2((3.6,) * 3, (5.0,), col_h=3.4, front='door_center', back='wall', base_h=0.4, **small),
                  t=(sx * (W / 2 - 4.0), y, 0.12), rot=-90 * sx)
    for y in (-28, 0, 24):                                                                            # 隔墙
        seg = (W - 1.2 - 5) / 2
        for sx in (-1, 1):
            g.add(kit2.wall_seg(seg, 3.0, 0.5), t=(sx * (2.5 + seg / 2), y, 0.12))
    return g

from _common import run  # noqa: E402

run('B01', make, budget=180000)
