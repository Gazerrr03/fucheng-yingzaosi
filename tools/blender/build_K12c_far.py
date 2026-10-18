"""K12c_far（远景简模，v1） 杂木团：三株阔叶树，高 8～11，团宽约 10。见任务卡 K12c。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402


def make():
    g = kit.Geo()
    g.add(kit.tree('broadleaf', 11, seed=11), t=(0, 0.8, 0))
    g.add(kit.tree('broadleaf', 9, seed=12), t=(-3.8, -1.2, 0), rot=70)
    g.add(kit.tree('broadleaf', 8.5, seed=13), t=(3.6, -1.6, 0), rot=150)
    return g


run('K12c_far', make, budget=3000)
