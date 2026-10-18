"""K13c_far（远景简模，v1） 篷船：长 12、宽 3，船中部半圆竹篷。任务卡 K13c。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401



def make():
    return kit.boat(12, covered=True, width=3.0)


run('K13c_far', make, budget=3000)
