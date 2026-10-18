"""K12b_far（远景简模，v1） 松：高 14，冠幅约 10，主干扭曲，针叶层层水平展开。任务卡 K12b。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401



def make():
    return kit.tree('pine', 14, seed=22)


run('K12b_far', make, budget=4000)
