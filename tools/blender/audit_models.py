"""模型体检：逐个导入 assets/models/*.glb，做几何检查并渲染三个视角（全景、人眼正面、屋檐近景），
每张图里放一个 1.7 米高的红色人形作尺度参照。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/audit_models.py [-- ID ...]
输出：assets/model_refs/_audit/{ID}_{wide,eye,close}.png 与 assets/model_refs/_audit/report.json
"""

import json
import math
import os
import sys
from collections import Counter

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'models')
OUT = os.path.join(ROOT, 'assets', 'model_refs', '_audit')


def clear():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)


def human(x, y):
    """1.7 米人形：身体圆柱 + 头部球。"""
    m = bpy.data.materials.new('human')
    m.diffuse_color = (0.85, 0.08, 0.05, 1)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=1.45, location=(x, y, 0.725), vertices=12)
    body = bpy.context.object
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.13, location=(x, y, 1.57), segments=12, ring_count=8)
    head = bpy.context.object
    for o in (body, head):
        o.data.materials.append(m)
        o.name = '_human'
    return body


def geometry_checks(objs):
    """返回几何问题统计。"""
    bm = bmesh.new()
    for o in objs:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(o.matrix_world)
        me = bpy.data.meshes.new('_tmp')
        tmp.to_mesh(me)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        tmp.free()
    # glTF 导入时平直着色的顶点按面拆开了，先按位置合并再统计
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.faces.ensure_lookup_table()
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    degenerate = sum(1 for f in bm.faces if f.calc_area() < 1e-6)
    # 共面重叠面（会在渲染时闪烁）：法线相同、所在平面相同、中心点几乎重合
    key = Counter()
    for f in bm.faces:
        if f.calc_area() < 1e-4:
            continue
        n = f.normal
        c = f.calc_center_median()
        key[(round(n.x, 2), round(n.y, 2), round(n.z, 2), round(n.dot(c), 2), round(c.x, 1), round(c.y, 1), round(c.z, 1))] += 1
    coplanar_dupes = sum(v - 1 for v in key.values() if v > 1)
    # 连通块与悬空块
    bm.verts.ensure_lookup_table()
    seen = set()
    islands = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        comp = []
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        zmin = min(p.co.z for p in comp)
        islands.append(zmin)
    bm.free()
    return {
        'tris': tris,
        'non_manifold_edges': non_manifold,
        'open_edges': boundary,
        'degenerate_faces': degenerate,
        'coplanar_overlaps': coplanar_dupes,
        'islands': len(islands),
    }


def setup_render(size):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = size[0]
    scene.render.resolution_y = size[1]
    scene.view_settings.view_transform = 'Standard'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_object_outline = True
    sh.object_outline_color = (0.1, 0.08, 0.06)
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_shadows = True
    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    scene.world.color = (0.93, 0.91, 0.86)


def shoot(cam, loc, target, lens, path):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def audit(asset_id):
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, f'{asset_id}.glb'))
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    stats = geometry_checks(objs)
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    ext = mx - mn
    stats['size'] = [round(v, 2) for v in ext]
    # 地面
    bpy.ops.mesh.primitive_plane_add(size=max(ext.x, ext.y) * 3 + 40, location=((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, -0.01))
    g = bpy.context.object
    gm = bpy.data.materials.new('ground')
    gm.diffuse_color = (0.78, 0.74, 0.64, 1)
    g.data.materials.append(gm)
    # 人形：站在正面（-Y）中线前 3 米
    hx, hy = (mn.x + mx.x) / 2 + 1.2, mn.y - 3.0
    human(hx, hy)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam_data.clip_end = 5000
    center = (mn + mx) / 2
    size = max(ext.x, ext.y, ext.z)
    os.makedirs(OUT, exist_ok=True)
    setup_render((1200, 900))
    # 全景：45° 轴测透视
    shoot(cam, center + Vector((size * 1.1, -size * 1.3, size * 0.9)), center, 50, os.path.join(OUT, f'{asset_id}_wide.png'))
    # 人眼：正面、1.6 米高、离正面 0.9 倍宽
    d = max(ext.x, 8) * 0.9
    shoot(cam, Vector((center.x - 2.0, mn.y - d, 1.6)), Vector((center.x, center.y, min(ext.z * 0.45, 8))), 24, os.path.join(OUT, f'{asset_id}_eye.png'))
    # 近景：从斜上方贴近最高处（通常是屋檐 / 垛口）
    top = Vector((center.x, center.y, mx.z * 0.82))
    shoot(cam, top + Vector((size * 0.22, -size * 0.32, size * 0.12)), top, 35, os.path.join(OUT, f'{asset_id}_close.png'))
    return stats


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ids = argv or sorted(f[:-4] for f in os.listdir(SRC) if f.endswith('.glb'))
    report_path = os.path.join(OUT, 'report.json')
    report = json.load(open(report_path)) if os.path.exists(report_path) else {}
    for i in ids:
        report[i] = audit(i)
        print(f'[audit] {i} {report[i]}')
    with open(report_path, 'w') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


main()
