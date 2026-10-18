"""B03_far（远景简模，v1） 保定一亩泉引水 + 水力石磨：一段架在石墩上的石砌引水渠，渠水跌落带动一座立式水轮，
水轮旁是一间单开间硬山磨坊（内有石磨）。依据：SM「引一亩泉河水入城……利用水能在城外建水力石磨」；任务卡 B03。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401



def wheel(r=3.4, width=1.2, spokes=8, seg=16):
    """立式水轮：轮辋 + 辐条 + 叶板，轴沿 Y。"""
    g = kit.Geo()
    for k in range(seg):
        a0, a1 = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
        quad = [(r * math.cos(a0), r * math.sin(a0)), (r * math.cos(a1), r * math.sin(a1)),
                ((r - 0.35) * math.cos(a1), (r - 0.35) * math.sin(a1)), ((r - 0.35) * math.cos(a0), (r - 0.35) * math.sin(a0))]
        for y in (-width / 2, width / 2):
            g.add(kit.extrude_xz(quad, 0.18, 'wood', y=y))
        # 叶板
        am = (a0 + a1) / 2
        pad = [(r * math.cos(am) - 0.05, r * math.sin(am)), ((r + 0.5) * math.cos(am) + 0.05, (r + 0.5) * math.sin(am)),
               ((r + 0.5) * math.cos(am) + 0.1, (r + 0.5) * math.sin(am) + 0.1), (r * math.cos(am), r * math.sin(am) + 0.1)]
        g.add(kit.extrude_xz(pad, width, 'wood'))
    for k in range(spokes):
        a = math.pi * k / spokes
        c, s = math.cos(a), math.sin(a)
        spoke = [(-r * c - 0.1 * s, -r * s + 0.1 * c), (r * c - 0.1 * s, r * s + 0.1 * c), (r * c + 0.1 * s, r * s - 0.1 * c), (-r * c + 0.1 * s, -r * s - 0.1 * c)]
        for y in (-width / 2, width / 2):
            g.add(kit.extrude_xz(spoke, 0.15, 'wood', y=y))
    return g


def make():
    g = kit.Geo()
    # 引水渠：沿 -X 方向来水，渠底高 7.6（高于水轮，跌水冲轮），架在石墩上
    for x in (-16, -11, -6):
        g.add(kit.box(1.2, 1.6, 7.6, 'stone', x=x))
    g.add(kit.box(14, 2.4, 0.5, 'stone', x=-10, z=7.6))
    for sy in (-1, 1):
        g.add(kit.box(14, 0.35, 0.9, 'stone', x=-10, y=sy * 1.05, z=8.1))
    g.add(kit.box(13.6, 1.6, 0.05, 'jade', x=-10, z=8.12))  # 渠水
    # 水轮坑（石砌）与水轮
    g.add(kit.enclosure(9, 4, 1.6, thick=0.5, material='stone', cap=None), t=(0, 0, 0))
    g.add(wheel(), t=(0, 0, 4.0))
    g.add(kit.box(0.5, 5.0, 0.5, 'trunk', y=1.0, z=3.8))  # 轮轴，伸向磨坊
    # 磨坊：台基 + 单开间小屋 + 石磨
    g.add(kit.box(9, 9, 1.0, 'stone', y=7.5))
    g.add(kit.hall(1, 6.0, 1, 6.0, 3.6, roof_kind='yingshan', infill='plaster', door_center=True, base_h=0.2, overhang=0.9), t=(0, 7.5, 1.0))
    g.add(kit.cyl(1.2, 0.5, 'stone', y=7.5, z=1.2, seg=10))
    g.add(kit.cyl(1.2, 0.4, 'stone', y=7.5, z=1.7, seg=10))
    return g


run('B03_far', make, budget=12000)
