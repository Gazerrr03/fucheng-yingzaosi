"""X02_far（远景简模，v1） 临汉门：城台 32×20×8，中央拱门洞 5×7 带拱券，门洞上方石匾；台上两层城楼（三开间带回廊，
重檐歇山），两侧各接 15 米城墙。依据：实拍 临汉门城门.jpg、临汉门城楼城墙.png；任务卡 X02。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402

W, D, H, BATTER = 32, 20, 8, 0.08


def make():
    g = kit.Geo()
    g.add(kit.platform(W, D, H, batter=BATTER, arch=(5, 7), arch_ring=0.8))
    ins = BATTER * H
    g.add(kit.merlon_ring(W - 2 * ins, D - 2 * ins, H))
    # 门洞上方石匾（贴在收分的前墙面上）
    zp = 7.6
    g.add(kit.box(3.6, 0.3, 1.4, 'marble', y=-(D / 2 - BATTER * zp) - 0.1, z=zp))
    g.add(kit.box(3.0, 0.35, 0.9, 'void', y=-(D / 2 - BATTER * zp) - 0.15, z=zp + 0.25))
    # 城楼：两层，底层带回廊
    g.add(kit.hall(3, 4.8, 2, 4.2, 4.8, roof_kind='xieshan', stories=2, gallery=True, door_center=True,
                   base_mat='brick_light', base_h=0.5, overhang=2.0), t=(0, 0, H))
    for sx in (-1, 1):
        g.add(kit.wall(15, H, 4.8, 9.6), t=(sx * (W / 2 + 7.5 - 0.6), 1.5, 0))
    return g


run('X02_far', make, budget=30000)
