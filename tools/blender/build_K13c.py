"""K13c 篷船（构件库 v2）：长 12、宽 3，船中部半圆竹篷（篷骨 + 篷面，篷内暗面），船尾舵与橹。任务卡 K13c。
远景简模见 build_K13c_far.py。"""

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
    return kit2.boat2(12, covered=True, width=3.0)

from _common import run  # noqa: E402

run('K13c', make, budget=8000)
