"""X04_far（远景简模，v1） 仲宣楼：城墙东南角城台 24×24×8，正面有登台石阶；台上两层重檐歇山楼阁（三开间，带平座），
两侧连接直角城墙。依据：规划文档「楼高 17 米，分城墙、城台、主体楼三部分」；任务卡 X04。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402

S, H = 24.0, 8.0


def make():
    g = kit.Geo()
    # 东南角：两段墙从转角向 -X、+Y 延伸（外侧分别朝 -Y、+X）
    g.add(kit.wall(22, H, 4.8, 9.6), t=(-S / 2 - 11 + 1.0, 4.0, 0))
    g.add(kit.wall(22, H, 4.8, 9.6), t=(S / 2 - 4.0, S / 2 + 11 - 1.0, 0), rot=90)
    g.add(kit.platform(S, S, H, batter=0.06))
    ins = 0.06 * H
    g.add(kit.merlon_ring(S - 2 * ins, S - 2 * ins, H))
    # 正面登台石阶（贴着城台前墙）
    g.add(kit.stair(5.0, 9.0, H), t=(0, -S / 2 - 4.2, 0))  # 自南向北登台
    g.add(kit.hall(3, 4.2, 3, 3.4, 4.4, roof_kind='xieshan', stories=2, double=True, door_center=True,
                   base_mat='brick_light', base_h=0.6, overhang=1.8), t=(0, 0, H))
    return g


run('X04_far', make, budget=30000)
