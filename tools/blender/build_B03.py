"""B03 保定一亩泉引水 + 水力石磨（构件库 v2）：一段架在石墩上的石砌引水渠（墩帽、渠帮条石、渠水），渠水跌落带动
一座立式水轮（双轮辋、辐条、轮毂、叶板），石砌轮坑；水轮旁一间单开间硬山磨坊（青砖墙、木门、格窗、筒瓦顶），
轮轴伸入磨坊带动石磨。依据：SM「引一亩泉河水入城……利用水能在城外建水力石磨」；任务卡 B03。
远景简模见 build_B03_far.py。"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import kit  # noqa: E402
import kit2  # noqa: E402

importlib.reload(kit)
importlib.reload(kit2)

def wheel(r=3.4, width=1.2, spokes=8, seg=20):
    g = kit.Geo()
    for k in range(seg):
        a0, a1 = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
        quad = [(r * math.cos(a0), r * math.sin(a0)), (r * math.cos(a1), r * math.sin(a1)),
                ((r - 0.35) * math.cos(a1), (r - 0.35) * math.sin(a1)), ((r - 0.35) * math.cos(a0), (r - 0.35) * math.sin(a0))]
        for y in (-width / 2, width / 2):
            g.add(kit.extrude_xz(quad, 0.18, 'wood', y=y))
        am = (a0 + a1) / 2
        c, s = math.cos(am), math.sin(am)
        pad = [((r - 0.1) * c - 0.05 * s, (r - 0.1) * s + 0.05 * c), ((r + 0.55) * c - 0.05 * s, (r + 0.55) * s + 0.05 * c),
               ((r + 0.55) * c + 0.05 * s, (r + 0.55) * s - 0.05 * c), ((r - 0.1) * c + 0.05 * s, (r - 0.1) * s - 0.05 * c)]
        g.add(kit.extrude_xz(pad, width + 0.1, 'wood'))
    for k in range(spokes):
        a = math.pi * k / spokes
        c, s = math.cos(a), math.sin(a)
        spoke = [(-r * c - 0.1 * s, -r * s + 0.1 * c), (r * c - 0.1 * s, r * s + 0.1 * c), (r * c + 0.1 * s, r * s - 0.1 * c),
                 (-r * c + 0.1 * s, -r * s - 0.1 * c)]
        for y in (-width / 2, width / 2):
            g.add(kit.extrude_xz(spoke, 0.15, 'trunk', y=y))
    hub = kit.Geo()
    hub.add(kit.cyl(0.55, width + 0.4, 'trunk', seg=10))
    g.add(hub, t=(0, width / 2 + 0.2, 0), rot=0)
    return g


def make():
    g = kit.Geo()
    for x in (-16, -11, -6):                                                                 # 石墩
        g.add(kit.box(1.4, 1.8, 7.2, 'stone', x=x, taper=0.08))
        g.add(kit.box(1.8, 2.4, 0.4, 'marble', x=x, z=7.2))
    g.add(kit.box(14, 2.4, 0.5, 'stone', x=-10, z=7.6))
    for sy in (-1, 1):
        for k in range(7):
            g.add(kit.box(1.96, 0.36, 0.9, 'stone', x=-16.0 + k * 2.0, y=sy * 1.05, z=8.1))
    g.add(kit.box(13.6, 1.6, 0.05, 'jade', x=-10, z=8.4))
    g.add(kit.box(1.2, 1.4, 0.05, 'jade', x=-2.6, z=8.0, taper=0.2))                         # 跌水
    g.add(kit2.enclosure2(9, 4, 1.6, thick=0.5, material='stone'))
    g.add(kit.box(8.0, 3.0, 0.4, 'jade'))
    w = wheel()
    g.add(w, t=(0, 0, 4.0))
    g.add(kit2.bar((0, -1.0, 4.0), (0, 5.0, 4.0), 0.4, 0.4, 'trunk'))                       # 轮轴
    g.add(kit.box(9, 9, 1.0, 'stone', y=7.5))
    g.add(kit2.house2(6.4, 6.0, 3.6, roof_h=2.2, gable='ying', wall_mat='brick', windows=2, tile_pitch=0.44),
          t=(0, 7.5, 1.0), rot=180)
    g.add(kit.cyl(1.1, 0.45, 'stone', y=7.8, z=1.45, seg=14))
    g.add(kit.cyl(1.1, 0.35, 'stone', y=7.8, z=1.9, seg=14))
    return g

from _common import run  # noqa: E402

run('B03', make, budget=40000)
