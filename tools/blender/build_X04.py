"""X04 仲宣楼（构件库 v2）：城墙东南角城台 24×24×8（石条基、腰线、垛口、吐水嘴、石匾），正面登台石阶
（汉白玉垂带）；台上两层楼阁（三开间，底层隔扇门，层间腰檐 + 平座木栏杆，歇山顶，形成重檐），
两侧连接直角城墙 v2。依据：规划文档「楼高 17 米，分城墙、城台、主体楼三部分」；任务卡 X04。
远景简模见 build_X04_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

S, H = 24.0, 8.0


def make():
    g = kit.Geo()
    # 东南角：两段墙从转角向 -X、+Y 延伸（外侧分别朝 -Y、+X）
    g.add(kit2.wall2(22, H, 4.8, 9.6), t=(-S / 2 - 11 + 1.0, 4.0, 0))
    g.add(kit2.wall2(22, H, 4.8, 9.6), t=(S / 2 - 4.0, S / 2 + 11 - 1.0, 0), rot=90)
    g.add(kit2.gate_platform2(S, S, H, None, None, batter=0.06, tablet=False))
    # 正面登台石阶：贴着城台前墙，自南向北
    run_ = 9.0
    g.add(kit.stair(5.0, run_, H), t=(0, -S / 2 - run_ / 2 + 0.3, 0))
    for sx in (-1, 1):
        g.add(kit.extrude_xz([(0, 0), (run_, 0), (0, H + 0.3)], 0.5, 'marble'), t=(sx * 2.75, -S / 2 + 0.3, 0), rot=90)
    g.add(kit2.hall2((3.8, 4.4, 3.8), (3.4, 3.4, 3.4), col_h=4.2, front='doors', back='windows', sides='windows',
                     base_h=0.6, base_mat='marble', stories=2, shrink=0.88, beasts=3), t=(0, 0.8, H + 0.06))
    return g


from _common import run  # noqa: E402

run('X04', make, budget=110000)
