"""K01_far（远景简模，v1） 城墙直段：长 40、高 8、顶宽 4.8、底宽 9.6；外侧收分带垛口（瓦帽），内侧女墙。见 docs/建模任务书.md 任务卡 K01。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import kit, run  # noqa: E402


def make():
    g = kit.Geo()
    g.add(kit.wall(40, 8, 4.8, 9.6, cap='tile'))
    return g


run('K01_far', make, budget=4000)
