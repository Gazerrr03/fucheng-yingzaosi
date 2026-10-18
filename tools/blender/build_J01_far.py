"""J01_far（远景简模，v1） 荆州东门 · 镇流门（宾阳楼）+ 瓮城：主城台 + 两层城楼；城外一圈近方形瓮城，四角各一座小角亭；
瓮城门开在外侧角部，与主门呈 45° 曲折相通。依据：「东门曰镇流，楼曰宾阳」（SM）；任务卡 J01、概念图 J01_v2。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

GW, GD, GH = 28, 18, 9
BW, BD, BH = 44, 34, 7.5


def pavilion():
    g = kit.Geo()
    g.add(kit.box(5.5, 5.5, 1.0, 'brick_light'))
    g.add(kit.hall(1, 3.6, 1, 3.6, 3.0, roof_kind='xieshan', base_mat='brick_light', base_h=0.2, overhang=1.0), t=(0, 0, 1.0))
    return g


def make():
    g = kit.Geo()
    g.add(kit.platform(GW, GD, GH, batter=0.08, arch=(5, 7), arch_ring=0.7))
    g.add(kit.merlon_ring(GW - 1.4, GD - 1.4, GH))
    g.add(kit.hall(3, 4.6, 2, 4.0, 4.4, roof_kind='xieshan', stories=2, door_center=True,
                   base_mat='brick_light', base_h=0.5, overhang=1.8), t=(0, 0, GH))
    for sx in (-1, 1):
        g.add(kit.wall(10, GH, 4.8, 9.6), t=(sx * (GW / 2 + 5 - 0.6), 1.5, 0))
    cy = -GD / 2 - BD / 2 + 1.0
    kw = dict(height=BH, top_w=4.0, bottom_w=6.0)
    gate_w = 9.0
    # 南面（外侧）留出东端给角门；西、东两侧整墙
    g.add(kit.wall(BW - gate_w, **kw), t=(-gate_w / 2, cy - BD / 2, 0))
    g.add(kit.wall(BD, **kw), t=(-BW / 2, cy, 0), rot=-90)
    g.add(kit.wall(BD - gate_w, **kw), t=(BW / 2, cy + gate_w / 2, 0), rot=90)
    # 角门：斜 45° 骑在东南角
    gate = kit.Geo()
    gate.add(kit.platform(gate_w + 2.0, 8.0, BH, batter=0.06, arch=(3.6, 5.2), arch_ring=0.5))
    gate.add(kit.hall(1, 4.4, 1, 4.0, 3.0, roof_kind='xieshan', base_mat='brick_light', base_h=0.3, overhang=1.2), t=(0, 0, BH))
    g.add(gate, t=(BW / 2 - gate_w / 2 + 1.0, cy - BD / 2 + gate_w / 2 - 1.0, 0), rot=45)
    # 其余三角的小角亭
    for x, y in [(-BW / 2, cy - BD / 2), (-BW / 2, cy + BD / 2 - 2), (BW / 2, cy + BD / 2 - 2)]:
        g.add(pavilion(), t=(x, y, BH))
    g.add(kit.box(BW - 5, BD - 5, 0.12, 'stone', y=cy))
    return g


run('J01_far', make, budget=30000)
