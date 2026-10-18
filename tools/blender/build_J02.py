"""J02 荆州大北门 · 拱辰门（朝宗楼）（构件库 v2）：宽大城台 34×22×9（石条基、腰线、拱券门洞 5.5×7.5、门扇门钉、
门额匾、垛口、吐水嘴），前墙四道砖砌壁柱；台上五开间、进深三间的两层城楼（腰檐 + 平座栏杆 + 歇山顶，重檐外观），
汉白玉台明栏杆、前出踏跺。依据：清道光重建的朝宗楼形制（面阔五间、进深三间、重檐歇山）；任务卡 J02。
远景简模见 build_J02_far.py。"""

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

W, D, H, BATTER = 34.0, 22.0, 9.0, 0.08


def make():
    g = kit.Geo()
    g.add(kit2.gate_platform2(W, D, H, 5.5, 7.5, batter=BATTER))
    for x in (-15.5, -6.5, 6.5, 15.5):                                                     # 壁柱
        g.add(kit.box(1.6, 1.0, H - 0.8, 'brick_light', x=x, y=-(D / 2) + 0.25, z=1.0, taper=0.05))
        g.add(kit.box(1.9, 1.3, 0.3, 'stone', x=x, y=-(D / 2) + 0.2, z=1.0))
    bx, by = (3.6,) * 5, (3.6, 3.6, 3.6)
    g.add(kit2.hall2(bx, by, col_h=4.6, front='doors', back='windows', base_h=0.7, base_mat='marble', stories=2,
                     shrink=0.88, front_steps=True, beasts=5), t=(0, 0.6, H + 0.06))
    g.add(kit2.stone_balustrade_ring(sum(bx) + 2.4, sum(by) + 2.4, H + 0.76, gap_front=4.6), t=(0, 0.6, 0))
    return g

from _common import run  # noqa: E402

run('J02', make, budget=150000)
