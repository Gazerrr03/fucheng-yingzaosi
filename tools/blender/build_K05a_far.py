"""K05a_far（远景简模，v1） 方形瓮城：主城台（拱门洞）+ 单檐城楼 + 两侧城墙；城门外（-Y）一圈方形瓮城墙 40×30，
墙高 7、顶带垛口；瓮城门开在东侧（屈曲开门），门上一座小箭楼。任务卡 K05a。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402

GW, GD, GH = 26, 18, 8          # 主城台
BW, BD, BH = 40, 30, 7          # 瓮城


def make():
    g = kit.Geo()
    # 主城门（城墙线在 y=0，城外为 -Y）
    g.add(kit.platform(GW, GD, GH, batter=0.08, arch=(5, 7), arch_ring=0.7))
    g.add(kit.merlon_ring(GW - 1.3, GD - 1.3, GH))
    g.add(kit.hall(3, 4.6, 2, 4.3, 4.5, roof_kind='xieshan', infill='plaster', door_center=True,
                   base_mat='brick_light', base_h=0.5, overhang=2.0), t=(0, 0, GH))
    for sx in (-1, 1):
        g.add(kit.wall(12, GH, 4.8, 9.6), t=(sx * (GW / 2 + 6 - 0.6), 1.5, 0))
    # 瓮城：西、南两面整墙，东面留门
    cy = -GD / 2 - BD / 2 + 1.0
    wall_kw = dict(height=BH, top_w=4.0, bottom_w=6.0)
    g.add(kit.wall(BW, **wall_kw), t=(0, cy - BD / 2, 0))                          # 南
    g.add(kit.wall(BD, **wall_kw), t=(-BW / 2, cy, 0), rot=-90)                     # 西（外侧朝 -X）
    gate_w = 7.0
    seg = (BD - gate_w) / 2
    for sy in (-1, 1):                                                               # 东，中间留门
        g.add(kit.wall(seg, **wall_kw), t=(BW / 2, cy + sy * (gate_w / 2 + seg / 2), 0), rot=90)
    # 瓮城门：小城台（东西向门洞）+ 小箭楼
    gate = kit.Geo()
    gate.add(kit.platform(gate_w + 1.0, 7.0, BH, batter=0.06, arch=(3.5, 5.0), arch_ring=0.5))
    gate.add(kit.hall(1, 4.6, 1, 4.0, 3.2, roof_kind='xieshan', base_mat='brick_light', base_h=0.3, overhang=1.2), t=(0, 0, BH))
    g.add(gate, t=(BW / 2, cy, 0), rot=90)
    # 瓮城地面
    g.add(kit.box(BW - 5, BD - 5, 0.12, 'stone', y=cy))
    return g


run('K05a_far', make, budget=25000)
