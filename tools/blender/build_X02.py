"""X02 临汉门（构件库 v2）：城台 32×20×8，拱券门洞 5×7、门扇门钉、门额匾、垛口；台上两层城楼——
底层三开间带一圈回廊（回廊柱上起下檐），二层收分、腰檐上设平座木栏杆，顶为歇山（重檐三滴水的外观）；
两侧各接 15 米城墙 v2，城内马道，台顶牙旗。依据：实拍 临汉门城门.jpg、临汉门城楼城墙.png；任务卡 X02。
远景简模见 build_X02_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

W, D, H, BATTER = 32.0, 20.0, 8.0, 0.08


def make():
    g = kit.Geo()
    g.add(kit2.gate_platform2(W, D, H, 5.0, 7.0, batter=BATTER))
    ins = BATTER * H
    tw, td = W - 2 * ins, D - 2 * ins
    g.add(kit2.hall2((4.2, 4.8, 4.2), (4.0, 4.0), col_h=4.2, front='doors', back='windows', base_h=0.45,
                     base_mat='stone', stories=2, gallery=1.5, shrink=0.88), t=(0, 0.4, H + 0.06))
    for sx in (-1, 1):
        g.add(kit2.wall2(15, H, 4.8, 9.6), t=(sx * (W / 2 + 7.5 - 0.6), 1.5, 0))
        g.add(kit2.banner(), t=(sx * (tw / 2 - 1.2), -td / 2 + 1.4, H + 0.06))
    g.add(kit2.ramp(20, H - 0.2, 3.2), t=(4.0, D / 2 + 1.7, 0))
    return g


from _common import run  # noqa: E402

run('X02', make, budget=110000)
