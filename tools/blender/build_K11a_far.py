"""K11a_far（远景简模，v1） 单孔石拱桥：长 20、宽 4，单孔，拱高 4.5，桥面起拱明显，两侧栏板。任务卡 K11a。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401



def make():
    return kit.arch_bridge(20, 4, spans=1, rise=4.5)


run('K11a_far', make, budget=4000)
