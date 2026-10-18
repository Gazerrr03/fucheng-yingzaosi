"""构件库示范：每个构件函数调用一次，排成网格，逐个渲染轴测图，再整体渲染四视图并导出。

界面里：Scripting 工作区打开本文件 → Run Script。
无界面：/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_kit_demo.py
输出：assets/model_refs/_kit/item_*.png、review_*.png、_kit_demo.glb
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

import bpy  # noqa: E402

import kit  # noqa: E402

importlib.reload(kit)  # 界面里反复运行时拿到最新的构件库

OUT = os.path.join(kit.ROOT, 'assets', 'model_refs', '_kit')

ITEMS = [
    ('wall', lambda: kit.wall(40, 8, 4.8, 9.6)),
    ('platform_arch', lambda: kit.platform(30, 20, 8, arch=(5, 7), crenel=True)),
    ('stair', lambda: kit.stair(6, 4, 1.5)),
    ('column_grid', lambda: kit.column_grid(3, 4.6, 2, 4.5, 4.5)),
    ('roof_yingshan', lambda: kit.roof('yingshan', 14, 9)),
    ('roof_wudian', lambda: kit.roof('wudian', 14, 9)),
    ('roof_xieshan', lambda: kit.roof('xieshan', 14, 9)),
    ('roof_juanpeng', lambda: kit.roof('juanpeng', 14, 9)),
    ('hall_xieshan', lambda: kit.hall(3, 4.6, 2, 4.5, 4.5, roof_kind='xieshan')),
    ('hall_double', lambda: kit.hall(5, 4.4, 3, 4.0, 5.0, roof_kind='xieshan', double=True)),
    ('hall_3story', lambda: kit.hall(5, 3.6, 3, 4.0, 5.0, roof_kind='xieshan', stories=3)),
    ('hall_gallery_2story', lambda: kit.hall(3, 4.6, 2, 4.5, 4.5, roof_kind='xieshan', stories=2, gallery=True)),
    ('house_yingshan', lambda: kit.hall(3, 3.4, 2, 3.0, 4.0, roof_kind='yingshan', wall='plaster')),
    ('ma_tou_wall', lambda: kit.ma_tou_wall(10, 2, 7)),
    ('enclosure', lambda: kit.enclosure(35, 35, 1.2, gates=[('S', 0, 3), ('N', 0, 3), ('E', 0, 3), ('W', 0, 3)])),
    ('wengcheng', lambda: kit.enclosure(40, 30, 7, thick=6, material='brick', cap='brick_light', crenel=True, gates=[('E', 4, 4)])),
    ('paifang_stone', lambda: kit.paifang(3, 12, 7, stone=True)),
    ('paifang_wood', lambda: kit.paifang(3, 12, 7, stone=False)),
    ('bridge_1', lambda: kit.arch_bridge(20, 4, 1, 4.5)),
    ('bridge_2', lambda: kit.arch_bridge(30, 5, 2, 4)),
    ('tree_broadleaf', lambda: kit.tree('broadleaf', 10, seed=1)),
    ('tree_pine', lambda: kit.tree('pine', 14, seed=2)),
    ('tree_willow', lambda: kit.tree('willow', 12, seed=3)),
    ('tree_ginkgo', lambda: kit.tree('ginkgo', 11, seed=4)),
    ('boat', lambda: kit.boat(10)),
    ('boat_covered', lambda: kit.boat(12, covered=True)),
    ('gate_tower', lambda: kit.gate_tower()),
]


def main():
    kit.setup_scene()
    cols = 6
    spacing = 70
    objs = []
    for i, (name, make) in enumerate(ITEMS):
        obj = kit.build(make(), name)
        obj.location = ((i % cols) * spacing, -(i // cols) * spacing, 0)
        objs.append(obj)
        tris, size, base = kit.stats(obj)
        print(f'[demo] {name:22s} {tris:6d} 面  尺寸 {size}  底面 z={base}')

    os.makedirs(OUT, exist_ok=True)
    # 逐个渲染轴测图
    for obj in objs:
        for o in objs:
            o.hide_set(o is not obj)
            o.hide_render = o is not obj
        kit.render_review('_kit', out_dir=OUT, size=512, views=('iso',))
        os.replace(os.path.join(OUT, 'review_iso.png'), os.path.join(OUT, f'item_{obj.name}.png'))
    for o in objs:
        o.hide_set(False)
        o.hide_render = False
    kit.render_review('_kit', out_dir=OUT, size=1600)
    kit.export('_kit_demo', path=os.path.join(OUT, '_kit_demo.glb'), save_blend=False)


def frame_viewport():
    """界面模式下：Layout 视口切到实体 + 材质色、正交轴测，并对准全部构件。"""
    import math
    import mathutils
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type != 'VIEW_3D':
                continue
            space = area.spaces.active
            space.shading.type = 'SOLID'
            space.shading.color_type = 'MATERIAL'
            r = space.region_3d
            r.view_rotation = mathutils.Euler((math.radians(60), 0, math.radians(-35))).to_quaternion()
            r.view_perspective = 'ORTHO'
            cols = 6
            rows = (len(ITEMS) + cols - 1) // cols
            r.view_location = ((cols - 1) * 70 / 2, -(rows - 1) * 70 / 2, 5)
            r.view_distance = 330
    return None

main()
if not bpy.app.background:
    bpy.app.timers.register(frame_viewport, first_interval=1.0)
