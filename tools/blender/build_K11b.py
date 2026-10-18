"""K11b 双孔石拱桥（构件库 v2）：长 30、宽 5，两孔，拱高 4，桥面中部起拱约 1.5；券石逐块、分水尖桥墩、
汉白玉栏杆、抱鼓石。任务卡 K11b。
远景简模见 build_K11b_far.py。"""

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
    return kit2.arch_bridge2(30, 5, spans=2, rise=4, deck_arch=1.5)

from _common import run  # noqa: E402

run('K11b', make, budget=20000)
