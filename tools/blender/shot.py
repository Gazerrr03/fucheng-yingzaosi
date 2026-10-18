"""透视测试图：shot(path, loc, target, lens) —— 在当前场景加地面、灯光与相机后渲染一张 Workbench 图。"""
import bpy
from mathutils import Vector


def prepare(ground=True):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
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
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=1000, location=(0, 0, -0.01))
        gm = bpy.data.materials.new('ground')
        gm.diffuse_color = (0.74, 0.70, 0.60, 1)
        bpy.context.object.data.materials.append(gm)


def shot(path, loc, target, lens=28, w=1400, h=900):
    scene = bpy.context.scene
    cam = scene.camera
    if cam is None or cam.data.type != 'PERSP':
        cam = bpy.data.objects.new('shot_cam', bpy.data.cameras.new('shot_cam'))
        scene.collection.objects.link(cam)
        scene.camera = cam
        cam.data.clip_start = 0.05
        cam.data.clip_end = 2000
    scene.render.resolution_x, scene.render.resolution_y = w, h
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
