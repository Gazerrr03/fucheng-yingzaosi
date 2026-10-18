"""K12b 松（构件库 v2）：高 14，主干分段扭曲上伸，侧枝两段水平伸出，枝上托层层扁平针叶云团。任务卡 K12b。
远景简模见 build_K12b_far.py。"""

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
    return kit2.tree2('pine', 14, seed=22)

from _common import run  # noqa: E402

run('K12b', make, budget=15000)
