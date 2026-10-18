"""K04a 城门（构件库 v2，近看精度）：城门台 + 单檐歇山城楼，按构件库 v2 的近看精度建模。
城台 30×20×8（石条基、腰线、拱券门洞、门扇门钉、门额匾、垛口望孔射孔、吐水嘴），
城楼三开间（明间 5.2、次间 4.4）、进深两间 4.4，柱础、收分柱、额枋箍头、雀替、斗栱、
隔扇门 / 槛窗，曲面歇山顶满铺筒瓦、鸱吻走兽；两侧城墙 v2，城内一侧马道，台顶旗杆。
输出 assets/models/K04a.glb；低精度远景版见 build_K04a_far.py。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

W, D, H = 30.0, 20.0, 8.0
BATTER = 0.09


def make():
    g = kit.Geo()
    g.add(kit2.gate_platform2(W, D, H, 5.0, 7.0, batter=BATTER))
    ins = BATTER * H
    tw, td = W - 2 * ins, D - 2 * ins
    g.add(kit2.hall2((4.4, 5.2, 4.4), (4.4, 4.4), col_h=4.6, front='doors', back='windows', base_h=0.5,
                     base_mat='stone'), t=(0, 0.6, H + 0.06))
    for sx in (-1, 1):
        g.add(kit2.wall2(12, H, 4.8, 9.6), t=(sx * (W / 2 + 6 - 0.6), 1.5, 0))
        g.add(kit2.banner(), t=(sx * (tw / 2 - 1.4), -td / 2 + 1.6, H + 0.06))
    g.add(kit2.ramp(18, H - 0.2, 3.2), t=(2.0, D / 2 + 1.7, 0))
    return g


from _common import run  # noqa: E402

run('K04a', make, budget=60000)
