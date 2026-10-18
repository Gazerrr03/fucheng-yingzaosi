"""X01 昭明台（构件库 v2）：台基 30×24×9（石条基、腰线、正中南北向拱券门洞 3.5×4.5 带门扇门钉、门额匾），
台顶汉白玉栏杆；台上居中三层楼阁（五开间，逐层收分，层间腰檐 + 平座栏杆，歇山顶），台前东西两角各一座
方形小楼（钟楼、鼓楼）。依据：「楼在郡治中央，高三层，面南，翼以钟鼓」；实拍 昭明台.png；任务卡 X01。
远景简模见 build_X01_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

W, D, H, BATTER = 30.0, 24.0, 9.0, 0.05


def make():
    g = kit.Geo()
    g.add(kit2.gate_platform2(W, D, H, 3.5, 4.5, batter=BATTER, parapet='balustrade'))
    g.add(kit2.hall2((3.0, 3.2, 3.6, 3.2, 3.0), (3.2, 3.2, 3.2), col_h=4.0, front='doors', back='windows',
                     base_h=0.6, base_mat='marble', stories=3, shrink=0.86, beasts=5), t=(0, 4.0, H + 0.06))
    for sx in (-1, 1):                                                                   # 钟楼、鼓楼
        g.add(kit2.hall2((3.8,), (3.8,), col_h=3.6, front='doors', back='windows', sides='windows', base_h=0.4,
                         base_mat='marble', lanterns=False, beasts=2), t=(sx * 11.3, -8.3, H + 0.06))
    return g


from _common import run  # noqa: E402

run('X01', make, budget=170000)
