"""K08_far（远景简模，v1） 衙署院落：院落约 40×80，坐北朝南；大门前照壁，中轴依次为大门、仪门、大堂（五开间单檐歇山，
台基 1）、二堂（五开间硬山），东西各两栋厢房，外围院墙。任务卡 K08。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

W, D = 40.0, 80.0


def make():
    g = kit.Geo()
    g.add(kit.enclosure(W, D, 3.2, thick=0.6, gates=[('S', 0, 12)], material='plaster', cap='tile'))
    g.add(kit.box(W - 2, D - 2, 0.12, 'stone'))
    # 照壁
    g.add(kit.box(14, 1.0, 4.0, 'plaster', y=-D / 2 - 9))
    g.add(kit.roof('wudian', 14, 1.0, h=1.0, overhang=0.6, thick=0.25), t=(0, -D / 2 - 9, 4.0))
    g.add(kit.hall(3, 4.0, 1, 6.5, 4.0, roof_kind='yingshan', door_center=True, overhang=1.0), t=(0, -D / 2, 0))   # 大门
    g.add(kit.hall(3, 3.6, 1, 5.0, 3.8, roof_kind='yingshan', door_center=True, overhang=1.0), t=(0, -20, 0))      # 仪门
    g.add(kit.hall(5, 4.0, 3, 4.0, 5.0, roof_kind='xieshan', door_center=True, base_h=1.0, overhang=1.8), t=(0, 2, 0))  # 大堂
    g.add(kit.hall(5, 3.8, 2, 4.5, 4.5, roof_kind='yingshan', door_center=True, overhang=1.2), t=(0, 27, 0))      # 二堂
    for sx in (-1, 1):                                                                                             # 厢房
        for y in (-8, 15):
            g.add(kit.hall(4, 4.2, 1, 5.5, 3.6, roof_kind='yingshan', overhang=0.8), t=(sx * (W / 2 - 4.5), y, 0), rot=90)
    return g


run('K08_far', make, budget=30000)
