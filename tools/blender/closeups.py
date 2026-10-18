"""近看检查：从人眼高度贴近拍几张特写（城门门扇、台顶看城楼正面、檐角仰视），每张带 1.7 米人形。
用法：Blender -b --factory-startup -P tools/blender/closeups.py -- {ID} [台顶高度 H]
输出：assets/model_refs/_audit/{ID}_cu_{door,deck,eave}.png
"""

import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:]
ASSET = argv[0]
H = float(argv[1]) if len(argv) > 1 else 8.0
OUT = os.path.join(ROOT, 'assets', 'model_refs', '_audit')

for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials):
    for item in list(coll):
        coll.remove(item)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'assets', 'models', f'{ASSET}.glb'))

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x, scene.render.resolution_y = 1400, 900
scene.view_settings.view_transform = 'Standard'
sh = scene.display.shading
sh.light = 'STUDIO'
sh.color_type = 'MATERIAL'
sh.show_object_outline = True
sh.object_outline_color = (0.1, 0.08, 0.06)
sh.show_cavity = True
sh.cavity_type = 'BOTH'
sh.show_shadows = True
scene.display.shadow_shift = 0.1
if scene.world is None:
    scene.world = bpy.data.worlds.new('World')
scene.world.color = (0.93, 0.91, 0.86)

bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.01))
gm = bpy.data.materials.new('ground')
gm.diffuse_color = (0.74, 0.70, 0.60, 1)
bpy.context.object.data.materials.append(gm)


def human(x, y, z=0.0):
    m = bpy.data.materials.new('human')
    m.diffuse_color = (0.85, 0.08, 0.05, 1)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=1.45, location=(x, y, z + 0.725), vertices=12)
    bpy.context.object.data.materials.append(m)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.13, location=(x, y, z + 1.57), segments=12, ring_count=8)
    bpy.context.object.data.materials.append(m)


cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.clip_start = 0.05


def shoot(name, loc, target, lens=24):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    scene.render.filepath = os.path.join(OUT, f'{ASSET}_cu_{name}.png')
    bpy.ops.render.render(write_still=True)


# 城台前方：人站在门洞右侧，相机 5 米外、1.6 米高
human(2.2, -11.2)
shoot('door', (-3.0, -16.5, 1.6), (0.5, -9.0, 4.0))
# 台顶：人站在城楼前，相机在台顶前沿垛口内侧
human(1.5, -5.6, H + 0.06)
shoot('deck', (-4.5, -8.6, H + 1.66), (0.0, -2.0, H + 4.5))
# 檐角仰视：站在台顶城楼角外，抬头看翼角与斗栱
shoot('eave', (-10.5, -6.5, H + 1.66), (-8.0, -4.2, H + 7.5), lens=20)
print('[closeups] done')
