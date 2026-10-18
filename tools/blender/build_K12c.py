"""K12c 杂木团（构件库 v2）：三株阔叶树，高 8～11，团宽约 10；递归分枝的树干，枝端挂树冠团。任务卡 K12c。
远景简模见 build_K12c_far.py。"""

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
    g = kit.Geo()
    g.add(kit2.tree2('broadleaf', 11, seed=11), t=(0, 0.8, 0))
    g.add(kit2.tree2('broadleaf', 9, seed=12), t=(-3.8, -1.2, 0), rot=70)
    g.add(kit2.tree2('broadleaf', 8.5, seed=13), t=(3.6, -1.6, 0), rot=150)
    return g

from _common import run  # noqa: E402

run('K12c', make, budget=20000)
