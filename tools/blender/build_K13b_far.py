"""K13b_far（远景简模，v1） 木船：长 10、宽 2.6，无篷，两头微翘，船内横梁与桨。任务卡 K13b。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401



def make():
    return kit.boat(10, width=2.6)


run('K13b_far', make, budget=2000)
