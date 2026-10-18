"""J01 荆州东门 · 镇流门（宾阳楼）+ 瓮城（构件库 v2）：主城台 28×18×9（拱券门洞、门扇门钉、门额匾、垛口）+
两层城楼（三开间，腰檐平座，歇山顶）+ 两侧城墙 v2；城外近方形瓮城，三角各一座小角亭，瓮城门斜 45° 骑在东南角
（门上小箭楼），与主门曲折相通。依据：「东门曰镇流，楼曰宾阳」（SM）；任务卡 J01、概念图 J01_v2。
远景简模见 build_J01_far.py。"""

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

GW, GD, GH = 28.0, 18.0, 9.0
BW, BD, BH = 44.0, 39.0, 7.5
Y0 = -3.0                              # 瓮城后边贴主城墙外皮


def pavilion():
    g = kit.Geo()
    g.add(kit.box(5.6, 5.6, 0.9, 'brick_light'))
    g.add(kit2.hall2((3.4,), (3.4,), col_h=3.0, front='doors', back='windows', sides='windows', base_h=0.25,
                     lanterns=False, beasts=1), t=(0, 0, 0.9))
    return g


def make():
    g = kit.Geo()
    g.add(kit2.gate_platform2(GW, GD, GH, 5.0, 7.0, batter=0.08))
    g.add(kit2.hall2((4.0, 4.6, 4.0), (3.8, 3.8), col_h=4.2, front='doors', back='windows', base_h=0.45,
                     base_mat='stone', stories=2, shrink=0.88), t=(0, 0.6, GH + 0.06))
    for sx in (-1, 1):
        g.add(kit2.wall2(10, GH, 4.8, 9.6), t=(sx * (GW / 2 + 5 - 0.6), 1.5, 0))
    cy = Y0 - BD / 2
    kw = dict(height=BH, top_w=3.6, bottom_w=6.0)
    gate_w = 9.0
    g.add(kit2.wall2(BW - gate_w + 3.0, **kw), t=(-gate_w / 2 - 1.5, cy - BD / 2, 0))
    g.add(kit2.wall2(BD + 3.0, **kw), t=(-BW / 2, cy, 0), rot=-90)
    g.add(kit2.wall2(BD - gate_w, **kw), t=(BW / 2, cy + gate_w / 2, 0), rot=90)
    g.add(kit2.small_gate(gate_w + 3.0, 8.0, BH, 3.6, 5.2, bays=(4.0,), bays_y=(3.4,), col_h=3.4),
          t=(BW / 2 - gate_w / 2 + 1.0, cy - BD / 2 + gate_w / 2 - 1.0, 0), rot=45)
    for x, y in [(-BW / 2, cy - BD / 2), (-BW / 2, cy + BD / 2 - 3), (BW / 2, cy + BD / 2 - 3)]:
        g.add(pavilion(), t=(x, y, BH))
    g.add(kit.box(BW - 6, BD - 6, 0.1, 'stone', y=cy))
    return g

from _common import run  # noqa: E402

run('J01', make, budget=150000)
