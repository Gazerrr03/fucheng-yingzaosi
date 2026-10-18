"""K11b_far（远景简模，v1） 双孔石拱桥：长 30、宽 5，两孔，拱高 4，桥面中部起拱约 1.5，两侧石栏板。任务卡 K11b。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401



def make():
    return kit.arch_bridge(30, 5, spans=2, rise=4, deck_arch=1.5)


run('K11b_far', make, budget=6000)
