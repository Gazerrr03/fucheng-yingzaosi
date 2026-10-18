"""X05_far（远景简模，v1） 绿影壁：庑殿式四柱三楼一字形影壁，全长约 26、高约 7.6、厚约 1.6；白石须弥座，壁心墨绿石板，
白石边框与柱枋，顶上三段庑殿瓦顶、中段高起。任务卡 X05（外观依据为网络资料，只作外观参考）。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401

L, T = 26.0, 1.6
PANELS = [(-8.7, 7.0, 4.6), (0.0, 9.0, 5.4), (8.7, 7.0, 4.6)]  # (中心 x, 宽, 壁身高)


def make():
    g = kit.Geo()
    g.add(kit.box(L + 1.2, T + 1.2, 0.5, 'marble'))
    g.add(kit.box(L + 0.6, T + 0.8, 0.7, 'marble', z=0.5, taper=0.15))  # 须弥座
    base = 1.2
    for cx, w, h in PANELS:
        g.add(kit.box(w, T, h, 'marble', x=cx, z=base))
        for sy in (-1, 1):  # 壁心（前后两面）
            g.add(kit.box(w - 1.4, 0.08, h - 1.4, 'jade', x=cx, y=sy * (T / 2 + 0.02), z=base + 0.7))
        roof_z = base + h
        g.add(kit.box(w + 0.2, T + 0.3, 0.45, 'marble', x=cx, z=roof_z))  # 额枋
        g.add(kit.roof('wudian', w, T + 0.2, h=1.4 if w < 8 else 1.7, overhang=0.7, thick=0.25), t=(cx, 0, roof_z + 0.45))
    for x in (-13.0, -4.5, 4.5, 13.0):  # 四柱
        hh = 5.4 if abs(x) < 5 else 4.6
        g.add(kit.box(1.0, T + 0.5, hh, 'marble', x=x, z=base))
    return g


run('X05_far', make, budget=15000)
