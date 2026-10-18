"""K12a_far（远景简模，v1） 柳：高 12，冠幅约 9，主干弯曲，枝条成束下垂。任务卡 K12a。"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402,F401



def make():
    return kit.tree('willow', 12, seed=21)


run('K12a_far', make, budget=4000)
