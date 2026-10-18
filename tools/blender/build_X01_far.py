"""X01_far（远景简模，v1） 昭明台：台基 30×24×9，正中南北向石拱门洞 3.5×4.5（内设朱红门扇），台顶汉白玉栏杆；
台上居中三层楼阁（五开间，逐层收分，歇山顶），东西两翼各一座方形小楼（钟楼、鼓楼）。
依据：「楼在郡治中央，高三层，面南，翼以钟鼓」；实拍 昭明台.png；任务卡 X01。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402

W, D, H, BATTER = 30, 24, 9, 0.05


def make():
    g = kit.Geo()
    g.add(kit.platform(W, D, H, batter=BATTER, arch=(3.5, 4.5), arch_ring=0.6, arch_door=True))
    ins = BATTER * H
    tw, td = W - 2 * ins, D - 2 * ins
    g.add(kit.balustrade_ring(tw, td, H))
    # 台身小窗（朱红）
    for x in (-10, -5.5, 5.5, 10):
        y = -(D / 2 - BATTER * 5.5) - 0.06
        g.face([(x - 0.4, y, 5.0), (x + 0.4, y, 5.0), (x + 0.4, y, 6.2), (x - 0.4, y, 6.2)], 'vermilion')
    # 主楼：三层
    g.add(kit.hall(5, 3.6, 3, 3.8, 4.6, roof_kind='xieshan', stories=3, door_center=True,
                   base_mat='marble', base_h=0.6, overhang=1.8), t=(0, 1.0, H))
    # 钟楼、鼓楼：两翼方形小楼
    for sx in (-1, 1):
        g.add(kit.hall(1, 5.0, 1, 5.0, 3.6, roof_kind='xieshan', base_mat='marble', base_h=0.4, overhang=1.3),
              t=(sx * 11.0, -5.5, H))
    return g


run('X01_far', make, budget=40000)
