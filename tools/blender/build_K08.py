"""K08 衙署院落（构件库 v2）：院落约 40×80，坐北朝南，粉墙瓦帽；大门前照壁（砖座、粉心、瓦顶）；
中轴依次为大门（三开间硬山）、仪门（三开间硬山）、大堂（五开间单檐歇山，斗栱，台基 1 米、前出踏跺）、
二堂（五开间硬山），东西各两栋厢房（四开间硬山小式），院内甬道。任务卡 K08。远景简模见 build_K08_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

W, D = 40.0, 80.0


def make():
    g = kit.Geo()
    g.add(kit2.enclosure2(W, D, 3.2, thick=0.6, gates=[('S', 0, 12)], material='plaster'))
    g.add(kit.box(W - 1.4, D - 1.4, 0.12, 'stone'))
    g.add(kit.box(4.0, 66, 0.06, 'brick_light', y=-4, z=0.12))                                 # 甬道
    # 照壁
    zb = kit.Geo()
    zb.add(kit.box(15, 1.6, 1.0, 'brick'))
    zb.add(kit.box(14, 1.1, 3.0, 'plaster', z=1.0))
    zb.add(kit.box(14.2, 1.25, 0.25, 'brick_light', z=4.0))
    for x in (-6.6, 6.6):
        zb.add(kit.box(0.8, 1.2, 3.0, 'brick', x=x, z=1.0))
    zb.add(kit2.roof_hip(14.6, 2.6, kind='wudian', h=1.0, overhang=0.4, lift=0.3, push=0.2, beasts=0, rafters=False),
           t=(0, 0, 4.25))
    g.add(zb, t=(0, -D / 2 - 9, 0))
    common = dict(dougong=False, lanterns=False, beasts=0, roof_kind='ying')
    g.add(kit2.hall2((3.6, 4.4, 3.6), (3.2, 3.2), col_h=3.8, front='door_center', back='open', base_h=0.6,
                     **common), t=(0, -D / 2 + 1.2, 0.12))                                     # 大门
    g.add(kit2.hall2((3.4, 4.0, 3.4), (2.6, 2.6), col_h=3.6, front='door_center', back='open', base_h=0.5,
                     **common), t=(0, -20, 0.12))                                              # 仪门
    g.add(kit2.hall2((3.8, 3.8, 4.4, 3.8, 3.8), (4.0, 4.0, 4.0), col_h=4.6, front='doors', back='windows',
                     base_h=1.0, front_steps=True, beasts=3, lanterns=True), t=(0, 2, 0.12))   # 大堂
    g.add(kit2.hall2((3.6, 3.6, 4.2, 3.6, 3.6), (4.4, 4.4), col_h=4.2, front='door_center', back='windows',
                     base_h=0.6, **common), t=(0, 27, 0.12))                                   # 二堂
    for sx in (-1, 1):                                                                         # 厢房
        for y in (-8, 15):
            g.add(kit2.hall2((4.0,) * 4, (5.0,), col_h=3.4, front='door_center', back='wall', base_h=0.4, **common),
                  t=(sx * (W / 2 - 4.5), y, 0.12), rot=-90 * sx)
    return g


from _common import run  # noqa: E402

run('K08', make, budget=150000)
