"""J04_far（远景简模，v1） 荆州南纪门（曲江楼）：主城台 + 两层城楼；城外同一轴线上另有一座箭楼城台（单檐小楼），两台之间以
瓮城墙相连；瓮城两侧各开侧门（门上小亭），通道呈十字形。依据：网络资料「主城台与箭楼城台在同一轴线上，
两侧开侧门，通道十字形」（只作外观参考）；SM「南纪门，楼曰曲江」；任务卡 J04。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

GW, GD, GH = 26, 18, 9


def side_gate():
    g = kit.Geo()
    g.add(kit.platform(10, 9, 7, batter=0.06, arch=(3.4, 5.0), arch_ring=0.5))
    g.add(kit.hall(1, 4.2, 1, 4.0, 3.0, roof_kind='xieshan', base_mat='brick_light', base_h=0.3, overhang=1.2), t=(0, 0, 7))
    return g


def make():
    g = kit.Geo()
    g.add(kit.platform(GW, GD, GH, batter=0.08, arch=(5, 7), arch_ring=0.7))
    g.add(kit.merlon_ring(GW - 1.4, GD - 1.4, GH))
    g.add(kit.hall(3, 4.4, 2, 3.8, 4.2, roof_kind='xieshan', stories=2, door_center=True,
                   base_mat='brick_light', base_h=0.5, overhang=1.8), t=(0, 0, GH))
    for sx in (-1, 1):
        g.add(kit.wall(12, GH, 4.8, 9.6), t=(sx * (GW / 2 + 6 - 0.6), 1.5, 0))
    # 箭楼城台（南）
    fy = -GD / 2 - 30
    g.add(kit.platform(16, 12, 8, batter=0.06, arch=(4.0, 5.8), arch_ring=0.5), t=(0, fy, 0))
    g.add(kit.merlon_ring(15, 11, 8), t=(0, fy, 0))
    g.add(kit.hall(3, 3.6, 1, 4.6, 3.6, roof_kind='xieshan', base_mat='brick_light', base_h=0.3, overhang=1.4), t=(0, fy, 8))
    # 两台之间的瓮城墙（东、西两道），中段开侧门
    kw = dict(height=7, top_w=3.6, bottom_w=5.6)
    span = 30 - 6
    for sx in (-1, 1):
        x = sx * 9.0
        for sy in (-1, 1):
            g.add(kit.wall(span / 2 - 5, **kw), t=(x, -GD / 2 - 15 + sy * (span / 4 + 2.5), 0), rot=sx * 90)
        g.add(side_gate(), t=(x, -GD / 2 - 15, 0), rot=sx * 90)
    return g


run('J04_far', make, budget=30000)
