"""X06 府儒学（文庙，构件库 v2）：院落约 50×70，红墙（砖下碱、瓦帽）；中轴自南向北为棂星门（石柱冲天式三间）
→ 戟门（三开间单檐歇山，带斗栱）→ 大成殿（五开间单檐歇山，斗栱、隔扇门，坐须弥座月台，汉白玉栏杆、
踏跺），大成殿前东西两庑（六开间硬山小式），棂星门外东西各一座石牌坊（圣域坊、贤关坊）。任务卡 X06。
远景简模见 build_X06_far.py。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

W, D = 50.0, 70.0


def make():
    g = kit.Geo()
    g.add(kit2.enclosure2(W, D, 3.6, thick=0.7, gates=[('S', 0, 12)], material='vermilion'))
    g.add(kit.box(W - 1.6, D - 1.6, 0.12, 'stone'))                                          # 院内铺地
    g.add(kit.box(5.0, 50, 0.06, 'brick_light', y=-8, z=0.12))                               # 甬道
    g.add(kit2.paifang2(3, 11, 6.0, stone=True, roofs=False), t=(0, -D / 2 - 1.5, 0))         # 棂星门
    for sx in (-1, 1):
        g.add(kit2.paifang2(1, 5, 5.5, stone=True, roofs=True), t=(sx * 16, -D / 2 - 8.0, 0))  # 圣域坊、贤关坊
    g.add(kit2.hall2((3.6, 4.4, 3.6), (3.2, 3.2), col_h=4.0, front='door_center', back='open', base_h=0.6,
                      lanterns=False, beasts=2), t=(0, -16, 0.12))                             # 戟门
    g.add(kit2.terrace(26, 18, 1.2, gap_front=6.0), t=(0, 16, 0.12))                          # 月台
    g.add(kit2.hall2((4.0, 4.0, 4.8, 4.0, 4.0), (4.0, 4.0, 4.0), col_h=5.0, front='doors', back='windows',
                     base_h=0.7, base_mat='marble', beasts=5, lanterns=False), t=(0, 18, 1.32))   # 大成殿
    for sx in (-1, 1):                                                                         # 东西两庑
        g.add(kit2.hall2((4.0,) * 6, (4.2,), col_h=3.6, front='door_center', back='wall', sides='wall', base_h=0.45,
                         roof_kind='ying', dougong=False, lanterns=False, beasts=0),
              t=(sx * (W / 2 - 5.0), 0, 0.12), rot=-90 * sx)
    return g


from _common import run  # noqa: E402

run('X06', make, budget=150000)
