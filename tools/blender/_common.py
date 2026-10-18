"""各资产构建脚本的公共入口：清场 → 生成 → 渲染四视图 → 导出 → 打印规格。"""

import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

importlib.reload(kit)  # 界面里反复运行时拿到最新的构件库


def run(asset_id, make, budget):
    kit.setup_scene()
    obj = kit.build(make(), asset_id)
    tris, size, base = kit.stats(obj)
    kit.render_review(asset_id)
    kit.export(asset_id)
    ok = tris <= budget
    print(f'[{asset_id}] {tris} 面（预算 {budget}，{"通过" if ok else "超出"}）  尺寸 {size}  底面 z={base}')
    return obj
