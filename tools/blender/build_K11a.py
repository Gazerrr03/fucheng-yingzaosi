"""K11a 单孔石拱桥（构件库 v2）：长 20、宽 4，单孔半椭圆拱，拱高 4.5；券石逐块、拱顶吸水兽，桥面条石，
汉白玉栏杆（望柱莲头、寻杖、净瓶、栏板）随坡，两端抱鼓石。任务卡 K11a。
远景简模见 build_K11a_far.py。"""

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

def make():
    return kit2.arch_bridge2(20, 4, spans=1, rise=4.5)

from _common import run  # noqa: E402

run('K11a', make, budget=15000)
