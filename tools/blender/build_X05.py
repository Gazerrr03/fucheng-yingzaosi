"""X05 绿影壁（构件库 v2）：庑殿式四柱三楼一字形影壁，全长约 26、高约 7.6、厚约 1.6；白石须弥座
（圭角、上下枋、束腰），壁心墨绿石板（前后两面，内嵌浮雕圆框与四岔角），白石边框、柱、额枋与仿木石斗栱，
顶上三段庑殿瓦顶（曲面、筒瓦、正脊吻兽），中段高起。任务卡 X05（外观依据为网络资料，只作外观参考）。
远景简模见 build_X05_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

L, T = 26.0, 1.6
PANELS = [(-8.7, 7.0, 4.6), (0.0, 9.0, 5.4), (8.7, 7.0, 4.6)]  # (中心 x, 宽, 壁身高)


def make():
    g = kit.Geo()
    # 须弥座
    g.add(kit.box(L + 1.4, T + 1.4, 0.3, 'stone'))
    g.add(kit.box(L + 1.2, T + 1.2, 0.25, 'marble', z=0.3))
    g.add(kit.box(L + 0.7, T + 0.7, 0.4, 'marble', z=0.55))
    g.add(kit.box(L + 1.1, T + 1.1, 0.25, 'marble', z=0.95))
    base = 1.2
    for cx, w, h in PANELS:
        g.add(kit.box(w, T, h, 'marble', x=cx, z=base))
        for sy in (-1, 1):
            y = sy * (T / 2 + 0.03)
            g.add(kit.box(w - 1.2, 0.08, h - 1.2, 'jade', x=cx, y=y, z=base + 0.6))             # 壁心
            g.add(kit.box(w - 0.9, 0.05, 0.12, 'marble', x=cx, y=y + sy * 0.04, z=base + 0.48))   # 线脚
            g.add(kit.box(w - 0.9, 0.05, 0.12, 'marble', x=cx, y=y + sy * 0.04, z=base + h - 0.6))
            r = min(w, h) * 0.22                                                                   # 浮雕圆框（盒子心）
            n = 16
            for k in range(n):
                a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
                p0 = (cx + r * math.cos(a0), y + sy * 0.06, base + h / 2 + r * math.sin(a0))
                p1 = (cx + r * math.cos(a1), y + sy * 0.06, base + h / 2 + r * math.sin(a1))
                g.add(kit2.bar(p0, p1, 0.12, 0.08, 'marble'))
            g.add(kit.box(r * 1.1, 0.1, r * 0.7, 'jade', x=cx, y=y + sy * 0.05, z=base + h / 2 - r * 0.35))
            for qx in (-1, 1):                                                                     # 岔角
                for qz in (0, 1):
                    zq = base + 0.6 + (h - 1.2 - 0.6) * qz
                    g.add(kit.extrude_xz([(0, 0), (0.9 * -qx, 0), (0, 0.6)] if qz == 0 else [(0, 0.6), (0.9 * -qx, 0.6), (0, 0)],
                                         0.06, 'marble', y=y + sy * 0.05), t=(cx + qx * (w / 2 - 0.6), 0, zq))
        roof_z = base + h
        g.add(kit.box(w + 0.2, T + 0.3, 0.45, 'marble', x=cx, z=roof_z))                          # 额枋
        n_dg = int(w / 1.1)
        for k in range(n_dg + 1):                                                                  # 石斗栱
            x = cx - w / 2 + k * w / n_dg
            for sy in (-1, 1):
                g.add(kit.box(0.3, 0.5, 0.2, 'marble', x=x, y=sy * (T / 2 + 0.15), z=roof_z + 0.45))
                g.add(kit.box(0.7, 0.18, 0.16, 'marble', x=x, y=sy * (T / 2 + 0.3), z=roof_z + 0.65))
        g.add(kit2.roof_hip(w + 0.6, T + 1.2, kind='wudian', h=1.4 if w < 8 else 1.7, overhang=0.55, lift=0.45,
                            push=0.3, beasts=2, rafters=False), t=(cx, 0, roof_z + 0.81))
    for x in (-13.0, -4.5, 4.5, 13.0):                                                            # 四柱
        hh = 5.4 if abs(x) < 5 else 4.6
        g.add(kit.box(1.0, T + 0.5, hh, 'marble', x=x, z=base))
        g.add(kit.box(1.2, T + 0.7, 0.3, 'marble', x=x, z=base))
    return g


from _common import run  # noqa: E402

run('X05', make, budget=40000)
