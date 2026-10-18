"""K12a 柳（构件库 v2）：高 12，粗短主干上分出五根主枝、再分小枝，枝端垂下成束的三段细柳条。任务卡 K12a。
远景简模见 build_K12a_far.py。"""

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
    return kit2.tree2('willow', 12, seed=21)

from _common import run  # noqa: E402

run('K12a', make, budget=15000)
