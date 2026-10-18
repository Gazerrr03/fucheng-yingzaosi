"""K01 城墙直段（构件库 v2）：长 40、高 8、顶宽 4.8、底宽 9.6；石条基、砖砌收分墙身、腰线，外侧垛口（望孔、射孔、瓦帽），
内侧宇墙，吐水嘴。任务卡 K01。
远景简模见 build_K01_far.py。"""

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
    g.add(kit2.wall2(40, 8, 4.8, 9.6))
    return g

from _common import run  # noqa: E402

run('K01', make, budget=8000)
