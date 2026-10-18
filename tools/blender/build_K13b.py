"""K13b 木船（构件库 v2）：长 10、宽 2.6，无篷，两头上翘；外板线、护舷木、肋骨横梁、舱底板，船尾舵与橹，舷边船桨。
任务卡 K13b。
远景简模见 build_K13b_far.py。"""

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
    return kit2.boat2(10, width=2.6)

from _common import run  # noqa: E402

run('K13b', make, budget=6000)
