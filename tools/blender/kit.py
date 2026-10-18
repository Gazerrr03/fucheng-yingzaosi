"""三府古城 · Blender 构件库（明代建筑参数化构件）

所有构件先在纯 Python 的 Geo 里拼装几何（不用布尔运算，界面和无界面模式都能稳定运行），
最后用 build() 一次性生成 Blender 物体。约定（见 docs/建模任务书.md 第 2 节）：
- 1 单位 = 1 米；Z 向上；原点在底面中心；正面朝 -Y（前视图看到的即正面，导出后在游戏里朝南）
- 只用色板材质，材质名即色板名
- 构件函数都返回 Geo；用 g.add(子构件, t=(x, y, z), rot=角度) 组合

典型用法（tools/blender/build_{ID}.py）：
    import kit
    kit.setup_scene()
    g = kit.Geo()
    g.add(kit.platform(30, 20, 8, arch=(5, 7)))
    g.add(kit.hall(3, 4.6, 2, 4.5, 4.5, roof='xieshan'), t=(0, 0, 8))
    kit.build(g, 'K04a')
    kit.render_review('K04a')
    kit.export('K04a')
"""

import math
import os
import random

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# 色板（sRGB），与 docs/建模任务书.md 第 2.3 节一致
PALETTE = {
    'brick': '#AA997F',
    'brick_light': '#C3AE90',
    'brick_dark': '#6A6254',
    'tile': '#535556',
    'ridge': '#3F4142',
    'vermilion': '#8A3E2C',
    'plaster': '#E6D5BD',
    'marble': '#E6DAC6',
    'stone': '#AFA189',
    'earth': '#E7C392',
    'wood': '#8A6B50',
    'trunk': '#755E45',
    'leaf': '#737C60',
    'pine': '#596351',
    'willow': '#798169',
    'ginkgo': '#CDB85E',
    'jade': '#65715C',
    'void': '#2B2520',
    # v2（构件库 kit2）用到的明代彩画色
    'teal': '#5B7A70',
    'qing': '#46607A',
    'gold': '#B89655',
    'ink': '#2F2A26',
}


# ---------------------------------------------------------------------------
# 场景与材质
# ---------------------------------------------------------------------------

def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def setup_scene():
    """清空场景，设为米制，并创建色板材质。"""
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    for name in PALETTE:
        mat(name)


def mat(name):
    """取色板材质（不存在时创建）。"""
    if name not in PALETTE:
        raise KeyError(f'材质 {name} 不在色板里：{", ".join(PALETTE)}')
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        rgb = _hex_rgb(PALETTE[name])
        lin = tuple(_srgb_to_linear(c) for c in rgb)
        m.diffuse_color = (*lin, 1.0)  # 视口 / Workbench 显示色
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (*lin, 1.0)
            bsdf.inputs['Metallic'].default_value = 0.0
            bsdf.inputs['Roughness'].default_value = 1.0
    return m


# ---------------------------------------------------------------------------
# 几何累加器
# ---------------------------------------------------------------------------

class Geo:
    """顶点 + 面 + 每面材质名。面不共享顶点，build() 时再按距离合并。"""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.mats = []

    def face(self, pts, material):
        i = len(self.verts)
        self.verts.extend((float(p[0]), float(p[1]), float(p[2])) for p in pts)
        self.faces.append(tuple(range(i, i + len(pts))))
        self.mats.append(material)
        return self

    def add(self, other, t=(0, 0, 0), rot=0.0, s=1.0):
        """把另一个 Geo 缩放 s、绕 Z 旋转 rot 度、平移 t 后并入。"""
        c, n = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        sx, sy, sz = (s, s, s) if not isinstance(s, (tuple, list)) else s
        base = len(self.verts)
        for x, y, z in other.verts:
            x, y, z = x * sx, y * sy, z * sz
            self.verts.append((c * x - n * y + t[0], n * x + c * y + t[1], z + t[2]))
        self.faces.extend(tuple(i + base for i in f) for f in other.faces)
        self.mats.extend(other.mats)
        return self

    def bounds(self):
        xs, ys, zs = zip(*self.verts) if self.verts else ((0,), (0,), (0,))
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def _ring(cx, cy, z, hw, hd):
    """矩形环（逆时针，从 -X-Y 角开始）。"""
    return [(cx - hw, cy - hd, z), (cx + hw, cy - hd, z), (cx + hw, cy + hd, z), (cx - hw, cy + hd, z)]


def prism(bottom, top, material, top_mat=None, bottom_mat=None, side_mats=None, cap_bottom=True, cap_top=True):
    """两个等点数的环之间连侧面，并封顶封底。法线在 build() 时统一重算。"""
    g = Geo()
    n = len(bottom)
    for i in range(n):
        j = (i + 1) % n
        m = side_mats[i] if side_mats else material
        g.face([bottom[i], bottom[j], top[j], top[i]], m)
    if cap_top:
        g.face(top, top_mat or material)
    if cap_bottom:
        g.face(list(reversed(bottom)), bottom_mat or material)
    return g


def box(sx, sy, sz, material, x=0, y=0, z=0, taper=0.0, top_mat=None):
    """长方体，底面中心在 (x, y, z)；taper 为顶面四边各向内收的距离。"""
    return prism(_ring(x, y, z, sx / 2, sy / 2), _ring(x, y, z + sz, sx / 2 - taper, sy / 2 - taper), material, top_mat=top_mat)


def cyl(r, h, material, x=0, y=0, z=0, seg=8, r_top=None, top_mat=None):
    """圆柱 / 圆台。"""
    rt = r if r_top is None else r_top
    bot = [(x + r * math.cos(2 * math.pi * k / seg), y + r * math.sin(2 * math.pi * k / seg), z) for k in range(seg)]
    top = [(x + rt * math.cos(2 * math.pi * k / seg), y + rt * math.sin(2 * math.pi * k / seg), z + h) for k in range(seg)]
    return prism(bot, top, material, top_mat=top_mat)


def beam(p0, p1, r0, r1, material, seg=5):
    """从 p0 到 p1 的斜向圆台（树枝、斜撑）。"""
    a, b = Vector(p0), Vector(p1)
    axis = (b - a).normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u)
    bot = [tuple(a + (u * math.cos(2 * math.pi * k / seg) + v * math.sin(2 * math.pi * k / seg)) * r0) for k in range(seg)]
    top = [tuple(b + (u * math.cos(2 * math.pi * k / seg) + v * math.sin(2 * math.pi * k / seg)) * r1) for k in range(seg)]
    return prism(bot, top, material)


def extrude_xz(profile, thickness, material, side_mat=None, y=0.0):
    """XZ 平面上的轮廓（可以是凹多边形）沿 Y 挤出 thickness，居中于 y。"""
    g = Geo()
    f = [(x, y - thickness / 2, z) for x, z in profile]
    b = [(x, y + thickness / 2, z) for x, z in profile]
    g.face(f, material)
    g.face(list(reversed(b)), material)
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        g.face([f[i], f[j], b[j], b[i]], side_mat or material)
    return g


def icosphere(r, material, x=0, y=0, z=0, jitter=0.0, seed=0, squash=(1, 1, 1)):
    """低面数二十面体（20 面），可加随机扰动做树冠。"""
    t = (1 + 5 ** 0.5) / 2
    v = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
         (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
         (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    rng = random.Random(seed)
    pts = []
    for p in v:
        l = math.sqrt(sum(c * c for c in p))
        k = r * (1 + rng.uniform(-jitter, jitter)) / l
        pts.append((x + p[0] * k * squash[0], y + p[1] * k * squash[1], z + p[2] * k * squash[2]))
    g = Geo()
    for a, b, c in f:
        g.face([pts[a], pts[b], pts[c]], material)
    return g


# ---------------------------------------------------------------------------
# 城墙类
# ---------------------------------------------------------------------------

def merlons_along(length, z, y, material='brick', w=1.2, h=1.6, gap=1.0, thick=0.6, cap=None):
    """沿 X 方向排一列垛口，居中于 x=0；cap 给材质名时每个垛口顶上加一片压顶。"""
    g = Geo()
    n = max(1, int((length + gap) // (w + gap)))
    span = n * w + (n - 1) * gap
    x0 = -span / 2 + w / 2
    for i in range(n):
        x = x0 + i * (w + gap)
        g.add(box(w, thick, h, material, x=x, y=y, z=z))
        if cap:
            g.add(box(w + 0.2, thick + 0.2, 0.22, cap, x=x, y=y, z=z + h))
    return g


def wall(length=40, height=8, top_w=4.8, bottom_w=9.6, crenel=True, merlon_w=1.2, merlon_h=1.6, gap=1.0, parapet_h=1.0, cap='tile'):
    """带收分的城墙段，沿 X 方向；外侧（-Y）收分并排垛口，内侧（+Y）竖直并有女墙。"""
    g = Geo()
    L, H = length, height
    y_in = bottom_w / 2
    y_out_top = y_in - top_w
    bottom = [(-L / 2, -y_in, 0), (L / 2, -y_in, 0), (L / 2, y_in, 0), (-L / 2, y_in, 0)]
    top = [(-L / 2, y_out_top, H), (L / 2, y_out_top, H), (L / 2, y_in, H), (-L / 2, y_in, H)]
    g.add(prism(bottom, top, 'brick', top_mat='brick_light'))
    g.add(box(L, bottom_w + 0.4, 0.6, 'brick_dark'))  # 墙基
    if crenel:
        g.add(merlons_along(L, H, y_out_top + 0.3, 'brick', merlon_w, merlon_h, gap, cap=cap))
        g.add(box(L, 0.4, parapet_h, 'brick', y=y_in - 0.2, z=H))
        if cap:
            g.add(box(L, 0.6, 0.2, cap, y=y_in - 0.2, z=H + parapet_h))
    return g


def platform(w, d, h, batter=0.06, arch=None, material='brick', top_mat='brick_light', crenel=False, base=True, arch_ring=0.0,
             arch_door=False):
    """砖砌城台 / 台基，四面收分。arch=(宽, 高) 时沿 Y 方向打通一个拱形门洞（半圆拱顶）；
    arch_ring>0 时在门洞前后面加一圈浅色拱券（宽度即参数值）。"""
    g = Geo()
    ins = batter * h
    if not arch:
        g.add(box(w, d, h, material, taper=ins, top_mat=top_mat))
    else:
        aw, ah = arch
        r = aw / 2
        spring = max(0.0, ah - r)
        seg = 10
        arc = [(-r, 0.0)] + [(-r, spring)] + [(-r * math.cos(math.pi * k / seg), spring + r * math.sin(math.pi * k / seg)) for k in range(1, seg)] + [(r, spring), (r, 0.0)]

        def yf(z, sign):  # 前后面随高度收分
            return sign * (d / 2 - ins * z / h)

        for sign in (-1, 1):
            outline = [(-w / 2, 0)] + arc + [(w / 2, 0), (w / 2 - ins, h), (-w / 2 + ins, h)]
            g.face([(x, yf(z, sign), z) for x, z in outline], material)
        # 两侧面、顶面、底面（底面让出门洞）
        for sx in (-1, 1):
            g.face([(sx * w / 2, -d / 2, 0), (sx * w / 2, d / 2, 0), (sx * (w / 2 - ins), d / 2 - ins, h), (sx * (w / 2 - ins), -d / 2 + ins, h)], material)
        g.face(_ring(0, 0, h, w / 2 - ins, d / 2 - ins), top_mat)
        g.face([(-w / 2, -d / 2, 0), (-r, -d / 2, 0), (-r, d / 2, 0), (-w / 2, d / 2, 0)], material)
        g.face([(r, -d / 2, 0), (w / 2, -d / 2, 0), (w / 2, d / 2, 0), (r, d / 2, 0)], material)
        # 门洞内壁
        for i in range(len(arc) - 1):
            (x0, z0), (x1, z1) = arc[i], arc[i + 1]
            g.face([(x0, yf(z0, -1), z0), (x1, yf(z1, -1), z1), (x1, yf(z1, 1), z1), (x0, yf(z0, 1), z0)], 'brick_dark')
        # 门扇：门洞里靠前的位置封一道朱红门板（门洞不再透光）
        if arch_door:
            yd = yf(0, -1) + 1.5
            g.face([(x, yd, z) for x, z in [(-r, 0.0)] + arc[1:-1] + [(r, 0.0)]], 'vermilion')
        # 拱券：贴在前后面上、略微凸出的一圈浅色砖
        if arch_ring > 0:
            ro = r + arch_ring
            inner = [(-r, spring)] + [(-r * math.cos(math.pi * k / seg), spring + r * math.sin(math.pi * k / seg)) for k in range(1, seg)] + [(r, spring)]
            outer = [(-ro, spring)] + [(-ro * math.cos(math.pi * k / seg), spring + ro * math.sin(math.pi * k / seg)) for k in range(1, seg)] + [(ro, spring)]
            for sign in (-1, 1):
                off = 0.12 * sign
                for i in range(len(inner) - 1):
                    q = [inner[i], inner[i + 1], outer[i + 1], outer[i]]
                    pts = [(x, yf(z, sign) + off, z) for x, z in q]
                    g.face(pts if sign < 0 else list(reversed(pts)), 'brick_light')
                for x in (-r - arch_ring / 2, r + arch_ring / 2):  # 拱脚
                    g.add(box(arch_ring, 0.3, spring, 'brick_light', x=x, y=yf(spring / 2, sign) + off * 0.5))
    if base:
        g.add(box(w + 0.4, d + 0.4, 0.5, 'brick_dark'))
    if crenel:
        tw, td = w - 2 * ins, d - 2 * ins
        g.add(merlons_along(tw - 1.0, h, -td / 2 + 0.3))
        g.add(merlons_along(tw - 1.0, h, td / 2 - 0.3))
        for sx in (-1, 1):
            g.add(merlons_along(td - 1.0, h, 0), t=(sx * (tw / 2 - 0.3), 0, 0), rot=90)
    return g


def merlon_ring(w, d, z, front_h=1.6, back_h=1.0, cap='tile', inset=0.3):
    """矩形台顶四周一圈垛口：前（-Y）高、后与两侧矮。"""
    g = Geo()
    g.add(merlons_along(w - 1.0, z, -d / 2 + inset, h=front_h, cap=cap))
    g.add(merlons_along(w - 1.0, z, d / 2 - inset, h=back_h, cap=cap))
    for sx in (-1, 1):
        g.add(merlons_along(d - 2.0, z, 0, h=back_h, cap=cap), t=(sx * (w / 2 - inset), 0, 0), rot=90)
    return g


def balustrade(length, h=1.1, material='marble', post_gap=2.0):
    """沿 X 方向的石栏杆：望柱 + 寻杖 + 栏板，居中于 x=0。"""
    g = Geo()
    g.add(box(length, 0.25, h * 0.55, material))
    g.add(box(length, 0.3, 0.15, material, z=h * 0.8))
    n = max(1, int(length // post_gap))
    for i in range(n + 1):
        g.add(box(0.35, 0.35, h + 0.2, material, x=-length / 2 + i * length / n))
    return g


def balustrade_ring(w, d, z, inset=0.4, gap_front=0.0):
    """矩形台顶四周一圈石栏杆；gap_front>0 时前面正中留出缺口（接台阶）。"""
    g = Geo()
    if gap_front > 0:
        seg = (w - 2 * inset - gap_front) / 2
        for sx in (-1, 1):
            g.add(balustrade(seg), t=(sx * (gap_front / 2 + seg / 2), -d / 2 + inset, z))
    else:
        g.add(balustrade(w - 2 * inset), t=(0, -d / 2 + inset, z))
    g.add(balustrade(w - 2 * inset), t=(0, d / 2 - inset, z))
    for sx in (-1, 1):
        g.add(balustrade(d - 2 * inset), t=(sx * (w / 2 - inset), 0, z), rot=90)
    return g


def porch(w, depth=2.0, h=3.4, posts=3, roof_drop=0.8):
    """店面前的披檐：一面坡瓦顶 + 朱红檐柱，贴在屋身正面（-Y）外，原点在屋身正面中点。"""
    g = Geo()
    y0, y1 = 0.0, -depth
    t = 0.25
    top = [(-w / 2, y0, h), (w / 2, y0, h), (w / 2, y1, h - roof_drop), (-w / 2, y1, h - roof_drop)]
    bot = [(x, y, z - t) for x, y, z in top]
    g.add(prism(bot, top, 'ridge', top_mat='tile'))
    for i in range(posts):
        x = -w / 2 + 0.4 + i * (w - 0.8) / max(1, posts - 1)
        g.add(cyl(0.18, h - roof_drop - t, 'vermilion', x=x, y=y1 + 0.3, seg=6))
    return g


def wall_corner(len_x=30.0, len_y=30.0, **kw):
    """城墙外转角（L 形）：一段沿 +X、一段沿 +Y，转角在原点，外侧分别朝 -Y 与 -X。"""
    g = Geo()
    g.add(wall(len_x, **kw), t=(len_x / 2, 0, 0))
    g.add(wall(len_y, **kw), t=(0, len_y / 2, 0), rot=-90)
    return g


def stair(w, run, rise, steps=None, material='stone'):
    """台阶：自 -Y 向 +Y 升高，底面中心在原点。"""
    g = Geo()
    n = steps or max(3, round(rise / 0.18))
    for i in range(n):
        depth = run * (n - i) / n
        g.add(box(w, depth, rise / n, material, y=run / 2 - depth / 2, z=i * rise / n))
    return g


def enclosure(w, d, h=3.0, thick=0.6, gates=None, material='plaster', cap='tile', crenel=False):
    """围墙 / 壝墙 / 瓮城墙。gates: [(边 'S'|'N'|'E'|'W', 沿边偏移, 门宽), ...]。"""
    g = Geo()
    gates = gates or []
    sides = {'S': (w, (0, -d / 2), 0), 'N': (w, (0, d / 2), 0), 'E': (d, (w / 2, 0), 90), 'W': (d, (-w / 2, 0), 90)}
    for side, (length, (cx, cy), rot) in sides.items():
        L = length + (thick if side in 'SN' else -thick)
        cuts = sorted((off - gw / 2, off + gw / 2) for s, off, gw in gates if s == side)
        pieces, start = [], -L / 2
        for a, b in cuts:
            if a > start:
                pieces.append((start, a))
            start = max(start, b)
        if start < L / 2:
            pieces.append((start, L / 2))
        for a, b in pieces:
            seg = Geo()
            seg.add(box(b - a, thick, h, material, x=(a + b) / 2))
            if cap:
                seg.add(box(b - a + 0.1, thick + 0.4, 0.3, cap, x=(a + b) / 2, z=h))
            if crenel:
                m = merlons_along(b - a - 0.4, h, -thick / 2 + 0.3)
                seg.add(m, t=((a + b) / 2, 0, 0))
            g.add(seg, t=(cx, cy, 0), rot=rot)
    return g


# ---------------------------------------------------------------------------
# 木构与屋顶
# ---------------------------------------------------------------------------

def column_grid(bays_x, bay_w, bays_y, bay_d, col_h, r=0.3, perimeter=True, material='vermilion'):
    """柱网：朱红圆柱 + 方形柱础。"""
    g = Geo()
    W, D = bays_x * bay_w, bays_y * bay_d
    for i in range(bays_x + 1):
        for j in range(bays_y + 1):
            if perimeter and 0 < i < bays_x and 0 < j < bays_y:
                continue
            x, y = -W / 2 + i * bay_w, -D / 2 + j * bay_d
            g.add(box(r * 3, r * 3, 0.25, 'stone', x=x, y=y))
            g.add(cyl(r, col_h, material, x=x, y=y, z=0.25))
    return g


def roof(kind, w, d, h=None, overhang=1.6, curve=0.2, thick=0.5):
    """屋顶，底面（檐口下沿）在 z=0。w、d 为屋身尺寸，屋檐再向外挑出 overhang。
    kind：'xieshan' 歇山、'wudian' 庑殿、'yingshan' 硬山、'juanpeng' 卷棚。
    curve 控制檐角起翘（只抬四角，檐口中段不动）与坡面内凹。"""
    g = Geo()
    h = h if h is not None else 0.55 * d + 1.5
    W, D = w + 2 * overhang, d + 2 * overhang
    t = thick
    top = t + h
    sag = curve * h * 0.6  # 坡面内凹量

    if kind in ('yingshan', 'juanpeng'):
        W = w + 0.6  # 山墙几乎不出挑
        E = _ring(0, 0, t, W / 2, D / 2)
        U = _ring(0, 0, 0, W / 2, D / 2)
        for i in range(4):
            j = (i + 1) % 4
            g.face([U[i], U[j], E[j], E[i]], 'ridge')
        g.face(list(reversed(U)), 'wood')
        if kind == 'yingshan':
            prof = [(-D / 2, t), (-D / 4, t + h * 0.45 - sag * 0.5), (0, top), (D / 4, t + h * 0.45 - sag * 0.5), (D / 2, t)]
        else:
            prof = [(-D / 2, t), (-D / 4, t + h * 0.45 - sag * 0.5), (-D * 0.08, top - 0.15), (0, top), (D * 0.08, top - 0.15),
                    (D / 4, t + h * 0.45 - sag * 0.5), (D / 2, t)]
        for i in range(len(prof) - 1):
            (y0, z0), (y1, z1) = prof[i], prof[i + 1]
            g.face([(-W / 2, y0, z0), (W / 2, y0, z0), (W / 2, y1, z1), (-W / 2, y1, z1)], 'tile')
        for sx in (-1, 1):
            g.face([(sx * W / 2, y, z) for y, z in prof], 'brick' if kind == 'yingshan' else 'plaster')
        if kind == 'yingshan':
            g.add(box(W + 0.6, 0.6, 0.7, 'ridge', z=top - 0.2))
            for sx in (-1, 1):
                g.add(box(0.6, 0.6, 1.4, 'ridge', x=sx * (W / 2 + 0.1), z=top - 0.2))
        return g

    # 四坡类（庑殿、歇山）：檐口每边细分，角部起翘外撇，中段不动
    lift = curve * h * 1.1
    push = overhang * 0.35
    fr = (0.0, 0.18, 0.5, 0.82, 1.0)
    cs = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    sides = []
    for i in range(4):
        (ax, ay), (bx, by) = cs[i], cs[(i + 1) % 4]
        pts = []
        for f in fr:
            x, y = ax + (bx - ax) * f, ay + (by - ay) * f
            k = abs(1 - 2 * f) ** 3  # 角部 1，中段 0
            px, py = x * W / 2, y * D / 2
            pts.append((px + (1 if px > 0 else -1) * push * k, py + (1 if py > 0 else -1) * push * k, t + lift * k))
        sides.append(pts)
    ring = [p for side in sides for p in side[:-1]]
    under = [(x, y, z - t) for x, y, z in ring]
    n = len(ring)
    for i in range(n):
        j = (i + 1) % n
        g.face([under[i], under[j], ring[j], ring[i]], 'ridge')
    g.face(list(reversed(under)), 'wood')

    if kind == 'wudian':
        Lr = max(W - D, W * 0.3)
        R = [(-Lr / 2, 0, top), (Lr / 2, 0, top)]
        mz = t + h * 0.42 - sag
        M = [(-Lr / 2 - D * 0.22, -D * 0.24, mz), (Lr / 2 + D * 0.22, -D * 0.24, mz), (Lr / 2 + D * 0.22, D * 0.24, mz), (-Lr / 2 - D * 0.22, D * 0.24, mz)]
        for i in range(4):
            j = (i + 1) % 4
            g.face(sides[i] + [M[j], M[i]], 'tile')
        g.face([M[0], M[1], R[1], R[0]], 'tile')
        g.face([M[2], M[3], R[0], R[1]], 'tile')
        g.face([M[1], M[2], R[1]], 'tile')
        g.face([M[3], M[0], R[0]], 'tile')
        g.add(box(Lr + 1.0, 0.6, 0.7, 'ridge', z=top - 0.2))
        for sx in (-1, 1):
            g.add(box(0.7, 0.6, 1.6, 'ridge', x=sx * (Lr / 2 + 0.2), z=top - 0.2))
        return g

    if kind == 'xieshan':
        k = 0.42  # 下段四坡占总高的比例
        b = D / 2 * 0.48
        a = min(b, W / 2 * 0.4)
        hz = t + h * k - sag
        M = [(-(W / 2 - a), -(D / 2 - b), hz), ((W / 2 - a), -(D / 2 - b), hz), ((W / 2 - a), (D / 2 - b), hz), (-(W / 2 - a), (D / 2 - b), hz)]
        R = [(-(W / 2 - a), 0, top), ((W / 2 - a), 0, top)]
        for i in range(4):
            j = (i + 1) % 4
            g.face(sides[i] + [M[j], M[i]], 'tile')
        g.face([M[0], M[1], R[1], R[0]], 'tile')
        g.face([M[2], M[3], R[0], R[1]], 'tile')
        g.face([M[1], M[2], R[1]], 'plaster')  # 山花
        g.face([M[3], M[0], R[0]], 'plaster')
        g.add(box(W - 2 * a + 1.0, 0.6, 0.7, 'ridge', z=top - 0.2))
        for sx in (-1, 1):
            g.add(box(0.7, 0.6, 1.6, 'ridge', x=sx * (W / 2 - a + 0.2), z=top - 0.2))
        return g

    raise ValueError(f'未知屋顶类型 {kind}')


def skirt(w, d, out=1.8, drop=1.2, thick=0.4, curve=0.12):
    """腰檐（重檐的下檐 / 楼阁层间的檐）：从屋身 (w, d) 向外下斜的一圈坡面，内沿在 z=drop，外沿底在 z=0。"""
    g = Geo()
    W, D = w + 2 * out, d + 2 * out
    lift = curve * drop * 2
    E = [(-W / 2, -D / 2, thick + lift), (W / 2, -D / 2, thick + lift), (W / 2, D / 2, thick + lift), (-W / 2, D / 2, thick + lift)]
    U = [(x, y, z - thick) for x, y, z in E]
    I = _ring(0, 0, thick + drop, w / 2, d / 2)
    Ib = _ring(0, 0, drop, w / 2, d / 2)
    for i in range(4):
        j = (i + 1) % 4
        g.face([E[i], E[j], I[j], I[i]], 'tile')
        g.face([U[i], U[j], E[j], E[i]], 'ridge')
        g.face([Ib[i], Ib[j], U[j], U[i]], 'wood')
    return g


def hall(bays_x=3, bay_w=4.5, bays_y=2, bay_d=4.5, col_h=4.5, roof_kind='xieshan', stories=1, base_h=0.6,
         gallery=False, double=False, wall='vermilion', roof_h=None, overhang=1.8, base_mat='stone', roof=None,
         infill=None, door_center=False):
    """一座木构殿 / 楼：台基、柱网、墙门窗、斗栱带、屋顶。stories>1 为楼阁，上层逐层收分，层间有腰檐。
    gallery=True 时底层外加一圈回廊柱；double=True 时顶层再加一道腰檐（重檐）。
    infill 给材质名时屋身为该材质的填充墙（如粉墙），上沿加一道朱红额枋；door_center=True 时底层明间开通高门洞。"""
    kind = roof or roof_kind
    g = Geo()
    W, D = bays_x * bay_w, bays_y * bay_d
    gal = 1.8 if gallery else 0.0
    g.add(box(W + 2 * gal + 2.4, D + 2 * gal + 2.4, base_h, base_mat))
    z = base_h
    sw, sd, ch, bw = W, D, col_h, bay_w
    for s in range(stories):
        last = s == stories - 1
        g.add(box(sw, sd, ch, infill or wall, z=z))
        if infill:
            g.add(box(sw + 0.12, sd + 0.12, 0.55, 'vermilion', z=z + ch - 0.55))  # 额枋
            g.add(box(sw + 0.12, sd + 0.12, 0.35, 'vermilion', z=z))  # 地栿
        nb_x = max(1, round(sw / bw))
        nb_y = bays_y
        g.add(column_grid(nb_x, sw / nb_x, nb_y, sd / nb_y, ch, r=0.28), t=(0, 0, z - 0.25))
        if gallery and s == 0:
            g.add(column_grid(nb_x + 2, (sw + 2 * gal) / (nb_x + 2), nb_y + 2, (sd + 2 * gal) / (nb_y + 2), ch, r=0.25), t=(0, 0, z - 0.25))
        # 门窗：每开间一块内凹暗面（前后两面）
        for i in range(nb_x):
            x = -sw / 2 + (i + 0.5) * sw / nb_x
            ww, wh, z0 = sw / nb_x * 0.62, ch * 0.72, z + 0.3
            if door_center and s == 0 and i == nb_x // 2:
                ww, wh, z0 = sw / nb_x * 0.72, ch - 0.6, z  # 明间门洞
            elif infill:
                ww, wh, z0 = sw / nb_x * 0.55, ch * 0.4, z + ch * 0.32  # 次间窗
            for sy in (-1, 1):
                g.add(box(ww, 0.16, wh, 'void', x=x, y=sy * sd / 2, z=z0))
        # 斗栱带
        ow = 0.9 if not (gallery and s == 0) else gal + 0.6
        g.add(box(sw + ow, sd + ow, 0.55, 'ridge', z=z + ch))
        top = z + ch + 0.55
        if not last:
            g.add(skirt(sw + (2 * gal if gallery and s == 0 else 0), sd + (2 * gal if gallery and s == 0 else 0), out=overhang, drop=1.0), t=(0, 0, top - 0.6))
            g.add(box(sw + 1.0, sd + 1.0, 0.4, 'wood', z=top + 0.5))  # 平座
            z = top + 0.9
            sw, sd, ch = sw * 0.84, sd * 0.86, ch * 0.85
        else:
            if double:
                g.add(skirt(sw + 2 * gal, sd + 2 * gal, out=overhang, drop=1.0), t=(0, 0, z + ch * 0.45))
            g.add(globals()['roof'](kind, sw + (2 * gal if gallery and stories == 1 else 0), sd + (2 * gal if gallery and stories == 1 else 0),
                                    h=roof_h, overhang=overhang), t=(0, 0, top))
    return g


def house(w=10.0, d=6.0, eave_h=4.0, roof_h=2.6, gable='matou', door=True, windows=True, steps=2, wall_mat='plaster'):
    """江汉地区硬山民居单体：粉墙 + 灰砖墙基 + 硬山屋顶；gable='matou' 时两端山墙做成马头墙。正面朝 -Y。"""
    g = Geo()
    g.add(box(w, d, eave_h, wall_mat))
    g.add(box(w + 0.1, d + 0.1, 0.7, 'brick_dark'))  # 墙基
    g.add(roof('yingshan', w, d - 1.2, h=roof_h, overhang=0.6, thick=0.35), t=(0, 0, eave_h - 0.1))
    if gable == 'matou':
        for sx in (-1, 1):
            g.add(ma_tou_wall(d + 1.0, steps, eave_h + roof_h + 1.8, 0.45, wall_mat), t=(sx * (w / 2 + 0.25), 0, 0), rot=90)
    if door:
        dw, dh = min(1.8, w * 0.2), eave_h * 0.65
        g.add(box(dw, 0.16, dh, 'vermilion', y=-d / 2, z=0.3))
        g.add(box(dw + 0.5, 0.25, 0.3, 'stone', y=-d / 2 - 0.15))  # 门槛石
    if windows:
        for x in (-w * 0.3, w * 0.3):
            g.add(box(1.2, 0.16, 0.9, 'void', x=x, y=-d / 2, z=eave_h * 0.45))
    return g


def ma_tou_wall(length=10, steps=2, height=7.0, thick=0.45, material='plaster'):
    """马头墙（阶梯状山墙），沿 X 方向，每级顶上压一道瓦檐。"""
    g = Geo()
    n = steps
    step_len = length / (2 * n + 1)
    step_h = height * 0.16
    tops = []
    x = -length / 2
    for i in range(n):
        z = height - (n - i) * step_h
        tops += [(x, z), (x + step_len, z)]
        x += step_len
    tops += [(x, height), (x + step_len, height)]
    x += step_len
    for i in range(n):
        z = height - (i + 1) * step_h
        tops += [(x, z), (x + step_len, z)]
        x += step_len
    profile = [(-length / 2, 0)] + tops + [(length / 2, 0)]
    g.add(extrude_xz(list(reversed(profile)), thick, material))
    for i in range(0, len(tops), 2):
        (x0, z0), (x1, _) = tops[i], tops[i + 1]
        g.add(box(x1 - x0 + 0.3, thick + 0.5, 0.28, 'tile', x=(x0 + x1) / 2, z=z0))
        g.add(box(0.3, thick + 0.3, 0.45, 'ridge', x=x1 + 0.1 if i == len(tops) - 2 else x0 - 0.1, z=z0 + 0.2))
    return g


def paifang(bays=3, w=12.0, h=7.0, stone=True):
    """牌坊 / 棂星门：方柱、额枋、每间顶上一段小屋顶（石牌坊为平顶石檐）。"""
    g = Geo()
    m_post = 'marble' if stone else 'vermilion'
    xs = [-w / 2 + i * w / bays for i in range(bays + 1)]
    for i, x in enumerate(xs):
        ph = h if 0 < i < bays else h * 0.82
        g.add(box(1.2, 1.2, 0.8, 'stone', x=x))  # 夹杆石
        g.add(box(0.6, 0.6, ph, m_post, x=x))
    for i in range(bays):
        x0, x1 = xs[i], xs[i + 1]
        mid = i == bays // 2
        bh = h if mid else h * 0.82
        g.add(box(x1 - x0 + 0.4, 0.5, 0.6, m_post, x=(x0 + x1) / 2, z=bh - 1.6))
        g.add(box(x1 - x0 + 0.4, 0.45, 0.4, m_post, x=(x0 + x1) / 2, z=bh - 2.6))
        if stone:
            g.add(box(x1 - x0 + 1.0, 1.4, 0.35, 'marble', x=(x0 + x1) / 2, z=bh - 0.2))
            g.add(box(x1 - x0 + 0.2, 0.5, 0.45, 'stone', x=(x0 + x1) / 2, z=bh + 0.15))
        else:
            g.add(roof('wudian', x1 - x0 + 0.4, 0.8, h=1.0, overhang=0.6, thick=0.25), t=((x0 + x1) / 2, 0, bh - 0.2))
    return g


# ---------------------------------------------------------------------------
# 桥、树、船
# ---------------------------------------------------------------------------

def arch_bridge(length=20.0, width=4.0, spans=1, rise=4.5, deck_arch=None, material='stone', rail='marble'):
    """石拱桥，沿 X 方向。桥中部 70% 范围内均分 spans 个半椭圆拱（矢高 rise），
    桥面在拱顶之上至少 1 米，两端以坡道落地；两侧望柱栏板。"""
    g = Geo()
    L = length
    span_total = L * 0.7
    sw = span_total / spans
    pier = sw * 0.16
    hw = (sw - pier) / 2                      # 拱的半跨
    crown = rise + 1.0                        # 拱顶上方桥面高度
    camber = deck_arch if deck_arch is not None else 0.5
    z_end = 0.6
    n_top = 24

    def deck_z(x):
        t = abs(x) / (L / 2)
        flat = span_total / L                 # 拱区所占比例
        if t <= flat:
            return crown + camber * math.cos(math.pi / 2 * t / flat)
        k = (t - flat) / (1 - flat)
        return z_end + (crown - z_end) * (1 - k) ** 1.4

    top = [(-L / 2 + L * i / n_top, deck_z(-L / 2 + L * i / n_top)) for i in range(n_top + 1)]
    bottom = [(L / 2, 0.0)]
    seg = 12
    for k in reversed(range(spans)):
        cx = -span_total / 2 + (k + 0.5) * sw
        for sidx in range(seg + 1):
            a = math.pi * sidx / seg
            bottom.append((cx + hw * math.cos(a), rise * math.sin(a)))
    bottom.append((-L / 2, 0.0))
    g.add(extrude_xz(top + bottom, width, material))
    # 拱券石：每个拱外圈一道略凸出的浅色券脸
    for k in range(spans):
        cx = -span_total / 2 + (k + 0.5) * sw
        for sy in (-1, 1):
            for sidx in range(seg):
                a0, a1 = math.pi * sidx / seg, math.pi * (sidx + 1) / seg
                q = [(cx + hw * math.cos(a0), rise * math.sin(a0)), (cx + hw * math.cos(a1), rise * math.sin(a1)),
                     (cx + (hw + 0.5) * math.cos(a1), (rise + 0.5) * math.sin(a1)), (cx + (hw + 0.5) * math.cos(a0), (rise + 0.5) * math.sin(a0))]
                g.add(extrude_xz(q, 0.12, rail, y=sy * (width / 2 + 0.03)))
    # 栏板与望柱
    for sy in (-1, 1):
        for i in range(n_top):
            (x0, z0), (x1, z1) = top[i], top[i + 1]
            panel = [(x0, z0), (x1, z1), (x1, z1 + 0.85), (x0, z0 + 0.85)]
            g.add(extrude_xz(panel, 0.22, rail, y=sy * (width / 2 - 0.11)))
        for x, z in top[::3]:
            g.add(box(0.32, 0.32, 1.15, rail, x=x, y=sy * (width / 2 - 0.11), z=z))
            g.add(box(0.36, 0.36, 0.18, rail, x=x, y=sy * (width / 2 - 0.11), z=z + 1.15, taper=0.08))
    return g


def tree(kind='broadleaf', height=10.0, seed=0):
    """低面数树：'broadleaf' 阔叶、'pine' 松、'willow' 柳、'ginkgo' 银杏。"""
    rng = random.Random(seed)
    g = Geo()
    lean = (rng.uniform(-0.08, 0.08) * height, rng.uniform(-0.08, 0.08) * height)
    th = height * (0.62 if kind == 'pine' else 0.5)
    r0 = height * (0.05 if kind == 'broadleaf' else 0.035)
    # 主干：两节，带一点弯曲
    mid = (lean[0] * 0.4, lean[1] * 0.4, th * 0.5)
    tip = (lean[0], lean[1], th)
    g.add(cyl(r0, th * 0.5, 'trunk', seg=6, r_top=r0 * 0.8))
    seg2 = cyl(r0 * 0.8, th * 0.5, 'trunk', seg=6, r_top=r0 * 0.5)
    g.add(seg2, t=(mid[0], mid[1], mid[2]))
    cx, cy, cz = tip
    if kind == 'broadleaf':
        n = 5
        for i in range(n):
            a = 2 * math.pi * i / n + rng.uniform(-0.4, 0.4)
            d = height * rng.uniform(0.14, 0.26)
            bz = cz + height * rng.uniform(0.12, 0.3)
            bx, by = cx + math.cos(a) * d, cy + math.sin(a) * d
            # 树枝：从主干上部分叉伸向每团树冠
            g.add(beam((mid[0] * 1.5, mid[1] * 1.5, th * 0.7), (bx, by, bz), r0 * 0.55, r0 * 0.25, 'trunk'))
            g.add(icosphere(height * rng.uniform(0.12, 0.17), 'leaf', bx, by, bz + height * 0.05, jitter=0.18,
                            seed=seed * 10 + i, squash=(1.1, 1.1, 0.75)))
        g.add(icosphere(height * 0.17, 'leaf', cx, cy, cz + height * 0.36, jitter=0.15, seed=seed * 10 + 9, squash=(1.1, 1.1, 0.8)))
    elif kind == 'ginkgo':
        for i in range(4):
            a = rng.uniform(0, 2 * math.pi)
            d = height * rng.uniform(0.03, 0.12)
            g.add(icosphere(height * rng.uniform(0.15, 0.2), 'ginkgo', cx + math.cos(a) * d, cy + math.sin(a) * d,
                            cz - height * 0.05 + i * height * 0.08, jitter=0.15, seed=seed * 10 + i, squash=(0.9, 0.9, 1.15)))
    elif kind == 'pine':
        # 古松：主干扭曲上伸，侧枝水平伸出，枝端托着扁平的针叶云团
        pads = 6
        for i in range(pads):
            z = th * (0.5 + 0.5 * i / (pads - 1))
            a = i * 2.4 + rng.uniform(-0.3, 0.3)
            reach = height * (0.3 - 0.035 * i)
            sx, sy = lean[0] * z / th, lean[1] * z / th
            ex, ey = sx + math.cos(a) * reach, sy + math.sin(a) * reach
            g.add(beam((sx, sy, z), (ex, ey, z + height * 0.03), r0 * 0.5, r0 * 0.25, 'trunk'))
            g.add(icosphere(height * (0.13 - 0.008 * i), 'pine', ex, ey, z + height * 0.06, jitter=0.15,
                            seed=seed * 10 + i, squash=(1.5, 1.5, 0.45)))
        g.add(icosphere(height * 0.1, 'pine', tip[0], tip[1], th + height * 0.05, jitter=0.1, seed=seed, squash=(1.4, 1.4, 0.5)))
    elif kind == 'willow':
        # 垂柳：几根弯曲的主枝向外伸出，枝端各挂一束下垂的细条
        crown_r = height * 0.13
        g.add(icosphere(crown_r, 'willow', cx, cy, cz + crown_r * 0.5, jitter=0.12, seed=seed, squash=(1.1, 1.1, 0.7)))
        arms = 5
        for j in range(arms):
            a = 2 * math.pi * j / arms + rng.uniform(-0.3, 0.3)
            reach = height * rng.uniform(0.18, 0.26)
            ax, ay, az = cx + math.cos(a) * reach, cy + math.sin(a) * reach, cz + height * rng.uniform(0.02, 0.12)
            g.add(beam((cx * 0.8, cy * 0.8, th * 0.85), (ax, ay, az), r0 * 0.45, r0 * 0.2, 'trunk'))
            g.add(icosphere(height * 0.07, 'willow', ax, ay, az, jitter=0.1, seed=seed * 7 + j, squash=(1, 1, 0.6)))
            for k in range(5):
                b = a + rng.uniform(-0.9, 0.9)
                rr = height * rng.uniform(0.02, 0.09)
                x, y = ax + math.cos(b) * rr, ay + math.sin(b) * rr
                ln = height * rng.uniform(0.25, 0.42)
                rr0 = height * 0.008
                p0 = (x, y, az)
                p1 = (x + math.cos(b) * 0.5, y + math.sin(b) * 0.5, az - ln * 0.45)   # 先向外再下垂
                p2 = (x + math.cos(b) * 0.6, y + math.sin(b) * 0.6, az - ln)
                g.add(beam(p0, p1, rr0 * 1.6, rr0 * 1.2, 'willow', seg=3))
                g.add(beam(p1, p2, rr0 * 1.2, rr0 * 0.4, 'willow', seg=3))
    else:
        raise ValueError(f'未知树种 {kind}')
    return g


def boat(length=10.0, covered=False, width=None):
    """木船（沿 X 方向），两头上翘；covered=True 时船中部加半圆竹篷。"""
    g = Geo()
    W = width or length * 0.26
    depth = W * 0.38
    ts = [-1.0, -0.65, -0.25, 0.25, 0.65, 1.0]
    secs = []
    for t in ts:
        hw = W / 2 * max(0.08, 1 - 0.8 * t * t)
        sheer = depth + depth * 0.6 * t * t
        bot = depth * 0.45 * t * t
        x = t * length / 2
        secs.append([(x, -hw, sheer), (x, -hw * 0.75, bot + depth * 0.25), (x, 0, bot), (x, hw * 0.75, bot + depth * 0.25), (x, hw, sheer)])
    for a, b in zip(secs[:-1], secs[1:]):
        for i in range(4):
            g.face([a[i], b[i], b[i + 1], a[i + 1]], 'wood')
        # 船内甲板（略低于舷）
        g.face([(a[0][0], a[0][1] * 0.92, a[0][2] - 0.15), (a[4][0], a[4][1] * 0.92, a[4][2] - 0.15),
                (b[4][0], b[4][1] * 0.92, b[4][2] - 0.15), (b[0][0], b[0][1] * 0.92, b[0][2] - 0.15)], 'wood')
    for sec in (secs[0], secs[-1]):
        g.face(sec, 'wood')
    for x in (-length * 0.2, length * 0.15):
        g.add(box(0.3, W * 0.85, 0.15, 'trunk', x=x, z=depth * 0.8))
    if covered:
        n = 8
        r = W * 0.5
        ln = length * 0.42
        arc = [(-r * math.cos(math.pi * k / n), depth * 0.85 + r * math.sin(math.pi * k / n)) for k in range(n + 1)]
        for k in range(n):
            (y0, z0), (y1, z1) = arc[k], arc[k + 1]
            g.face([(-ln / 2, y0, z0), (ln / 2, y0, z0), (ln / 2, y1, z1), (-ln / 2, y1, z1)], 'earth')
        for sx in (-1, 1):
            g.face([(sx * ln / 2, y, z) for y, z in arc], 'void')
    else:
        oar = box(length * 0.55, 0.12, 0.12, 'trunk', z=0)
        g.add(oar, t=(0, W * 0.35, depth * 1.1), rot=8)
    return g


# ---------------------------------------------------------------------------
# 组合件
# ---------------------------------------------------------------------------

def gate_tower(w=30, d=20, h=8, arch=(5, 7), bays=3, bay_w=4.6, bays_y=2, bay_d=4.5, col_h=4.5, stories=1,
               double=False, gallery=False, wall_len=10, roof_kind='xieshan'):
    """城门：城台（贯通门洞）+ 台上城楼 + 两侧城墙段，城台顶四周垛口。正面朝 -Y。"""
    g = Geo()
    g.add(platform(w, d, h, arch=arch))
    ins = 0.06 * h
    g.add(merlons_along(w - 2 * ins - 1.0, h, -d / 2 + ins + 0.3))
    g.add(merlons_along(w - 2 * ins - 1.0, h, d / 2 - ins - 0.3, h=1.0))
    g.add(hall(bays, bay_w, bays_y, bay_d, col_h, roof_kind=roof_kind, stories=stories, double=double, gallery=gallery,
               base_mat='brick_light', base_h=0.5), t=(0, 0, h))
    if wall_len > 0:
        for sx in (-1, 1):
            g.add(wall(wall_len, h, 4.8, min(9.6, d * 0.6)), t=(sx * (w / 2 + wall_len / 2 - 0.5), 0, 0))
    return g


# ---------------------------------------------------------------------------
# 生成物体、检查、导出
# ---------------------------------------------------------------------------

def _remove_hidden_faces(bm):
    """清理会造成闪烁或看不见的面：
    1) 贴地朝下的底面（落在 z≈0，永远看不到）；
    2) 顶点完全相同的重复面（两个构件在同一处叠放时产生）：同向重复保留一个，反向成对则都删（两块体贴合处的内部面）。"""
    bm.faces.ensure_lookup_table()
    kill = set()
    for f in bm.faces:
        if f.normal.z < -0.99 and all(v.co.z < 0.02 for v in f.verts):
            kill.add(f)
    seen = {}
    for f in bm.faces:
        if f in kill:
            continue
        key = frozenset(v.index for v in f.verts)
        other = seen.get(key)
        if other is None:
            seen[key] = f
            continue
        if f.normal.dot(other.normal) > 0:
            kill.add(f)
        else:
            kill.add(f)
            kill.add(other)
            del seen[key]
    bmesh.ops.delete(bm, geom=list(kill), context='FACES_ONLY')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')


def build(geo, name, merge_dist=1e-4):
    """把 Geo 生成为一个 Blender 物体：合并重合顶点、统一法线朝外、平直着色、按材质名分配材质。"""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(geo.verts, [], geo.faces)
    names = list(dict.fromkeys(geo.mats))
    for n in names:
        mesh.materials.append(mat(n))
    idx = {n: i for i, n in enumerate(names)}
    for poly, m in zip(mesh.polygons, geo.mats):
        poly.material_index = idx[m]
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_dist)
    _remove_hidden_faces(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = False
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def stats(obj=None):
    """返回 (三角面数, 尺寸 xyz, 底面 z)。"""
    objs = [obj] if obj else [o for o in bpy.context.scene.objects if o.type == 'MESH']
    tris = 0
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    return tris, tuple(round(c, 2) for c in (mx - mn)), round(mn.z, 3)


def _look_at(cam, target, direction, dist):
    loc = Vector(target) - Vector(direction).normalized() * dist
    cam.location = loc
    cam.rotation_euler = (Vector(target) - loc).to_track_quat('-Z', 'Y').to_euler()


def render_review(asset_id, out_dir=None, size=1024, views=('front', 'right', 'top', 'iso')):
    """Workbench 平光 + 轮廓线，渲染前、右、顶、轴测四视图到 assets/model_refs/{id}/review_*.png。"""
    out_dir = out_dir or os.path.join(ROOT, 'assets', 'model_refs', asset_id)
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    objs = [o for o in scene.objects if o.type == 'MESH' and o.visible_get()]
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    center = (mn + mx) / 2
    ext = mx - mn
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_object_outline = True
    sh.object_outline_color = (0.1, 0.08, 0.06)
    sh.show_cavity = True
    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    scene.world.color = (1, 1, 1)
    cam_data = bpy.data.cameras.new('review_cam')
    cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new('review_cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    dist = max(ext) * 3 + 10
    dirs = {
        'front': ((0, 1, 0), max(ext.x, ext.z)),
        'right': ((-1, 0, 0), max(ext.y, ext.z)),
        'top': ((0, 0, -1), max(ext.x, ext.y)),
        'iso': ((1, 1, -0.9), max(ext.x, ext.y, ext.z) * 1.35),
    }
    paths = []
    for v in views:
        d, span = dirs[v]
        cam_data.ortho_scale = span * 1.15 + 1
        cam_data.clip_end = dist * 3
        _look_at(cam, center, d, dist)
        if v == 'top':
            cam.rotation_euler = (0, 0, 0)
            cam.location = (center.x, center.y, mx.z + dist)
        path = os.path.join(out_dir, f'review_{v}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cam_data)
    return paths


def export(asset_id, path=None, save_blend=True):
    """合并场景里的网格为一个物体，导出 glb（未压缩、+Y 向上），并保存 .blend。"""
    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == 'MESH']
    if not meshes:
        raise RuntimeError('场景里没有网格')
    for o in scene.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = asset_id
    path = path or os.path.join(ROOT, 'assets', 'models', f'{asset_id}.glb')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=True,
        export_materials='EXPORT', export_cameras=False, export_lights=False,
        export_animations=False, use_visible=True,
    )
    if save_blend:
        blend_dir = os.path.join(ROOT, 'assets', 'blender')
        os.makedirs(blend_dir, exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0  # 不生成 .blend1 备份
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, f'{asset_id}.blend'), copy=True)
    tris, size, base = stats(obj)
    print(f'[kit] 导出 {asset_id} → {path}  {tris} 面  尺寸 {size}  底面 z={base}')
    return path
