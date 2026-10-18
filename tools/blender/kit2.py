"""三府古城 · 构件库 v2（近看精度）

目标：人站在旁边看也站得住，精度向《文明 6》的建筑看齐。与 v1（kit.py）的关系：
- 共用 Geo 累加器、色板、build/export/render 等基础设施（从 kit 导入）；
- v1 的城墙、平台、树等仍可用；v2 提供精细的屋顶、斗栱、柱额、门窗、台基、城门与道具。

坐标约定同 v1：1 单位 = 1 米，Z 向上，正面朝 -Y，原点在底面中心。
"""

import math
import random

from mathutils import Vector

import kit
from kit import Geo, beam, box, cyl, extrude_xz, prism

# v2 用到的彩画色（teal、qing、gold、ink）已写进 kit.PALETTE


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------

def _v(p):
    return Vector(p)


def grid(rows, material, g=None):
    """rows[j][i] 是点阵，相邻四点连成四边面。"""
    g = g or Geo()
    for j in range(len(rows) - 1):
        a, b = rows[j], rows[j + 1]
        for i in range(len(a) - 1):
            g.face([a[i], a[i + 1], b[i + 1], b[i]], material)
    return g


def bar(p0, p1, w, h, material):
    """两点之间的方截面杆件（宽 w、高 h），截面竖直对齐；用于栏杆、棂条、脊。"""
    a, b = _v(p0), _v(p1)
    t = (b - a).normalized()
    up = Vector((0, 0, 1))
    side = t.cross(up)
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(t).normalized()
    def ring(c):
        return [tuple(c + side * sx * w / 2 + up * sz * h / 2) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    return prism(ring(a), ring(b), material)


def tri_prism_y(p, depth, material, y=0.0):
    """XZ 平面上的三角形沿 Y 挤出（垂带石等）。"""
    return extrude_xz(p, depth, material, y=y)


# ---------------------------------------------------------------------------
# 屋顶：曲面 + 瓦垄 + 脊饰 + 檐椽
# ---------------------------------------------------------------------------

def roof_xieshan(w, d, **kw):
    """歇山顶（兼容旧接口）。"""
    return roof_hip(w, d, kind='xieshan', **kw)


def roof_hip(w, d, kind='xieshan', h=None, overhang=2.4, lift=1.2, push=0.9, tile_pitch=0.36, t=0.32, chuji=0.6,
             beasts=3, rafters=True, inner=None):
    """四坡类屋顶。w、d 为檐檩（柱网 + 斗栱出挑）围成的尺寸；底边（檐口下沿）在 z=0。
    kind：
      'xieshan' 歇山：下段四坡 + 上段前后两坡，出际 chuji，山花板与博缝板封山；
      'wudian'  庑殿：四坡直达正脊，左右两坡收成三角；
      'skirt'   腰檐 / 重檐下檐：只有下段四坡，上沿贴到 inner=(iw, id) 的墙身，高 h，没有脊。
    举折上陡下缓；翼角起翘 lift、出冲 push；满铺筒瓦垄与瓦当；正脊鸱吻、垂脊、戗脊与走兽。"""
    g = Geo()
    h = h if h is not None else (0.55 * d if kind != 'skirt' else 1.6)
    W2, D2 = w / 2 + overhang, d / 2 + overhang
    if kind == 'xieshan':
        b = D2 * 0.52                      # 下段进深（从檐口到上下段分界）
        a = min(b, W2 * 0.42)
        hz = t + h * 0.46                  # 上下段分界高度
    elif kind == 'wudian':
        b = D2
        a = min(D2, W2 * 0.75)
        hz = t + h
    else:
        iw, id_ = inner
        a, b = W2 - iw / 2, D2 - id_ / 2
        hz = t + h
    top = t + h
    has_upper = kind == 'xieshan'
    NV, NU_F, NU_S = 7, 26, 12

    def k(u):
        return abs(u) ** 2.6

    def eave(side, u):
        """四边檐口曲线；side: 0 前、1 右、2 后、3 左；u ∈ [-1, 1]，沿逆时针方向。"""
        kk = k(u)
        lx, ly = W2 + push * kk, D2 + push * kk
        z = t + lift * kk
        if side == 0:
            return (u * lx, -ly, z)
        if side == 1:
            return (lx, u * ly, z)
        if side == 2:
            return (-u * lx, ly, z)
        return (-lx, -u * ly, z)

    def topline(side, u):
        if side == 0:
            return (u * (W2 - a), -(D2 - b), hz)
        if side == 1:
            return (W2 - a, u * (D2 - b), hz)
        if side == 2:
            return (-u * (W2 - a), D2 - b, hz)
        return (-(W2 - a), -u * (D2 - b), hz)

    def lower(side, u, v):
        e, tp = eave(side, u), topline(side, u)
        z = e[2] + (tp[2] - e[2]) * v ** 1.45      # 举折：越往上越陡
        return (e[0] + (tp[0] - e[0]) * v, e[1] + (tp[1] - e[1]) * v, z)

    XU = W2 - a + chuji                    # 上段两坡（含出际）的半宽

    def upper(sign, u, v):
        """上段：sign=-1 前坡、+1 后坡；u ∈ [-1,1] 沿 x；v 从分界线到正脊。"""
        y0 = sign * (D2 - b)
        z = hz + (top - hz) * v ** 1.25
        return (u * XU, y0 * (1 - v), z)

    def normal_at(f, *args, du=1e-3):
        u, v = args[-2], args[-1]
        pre = args[:-2]
        p = _v(f(*pre, u, v))
        pu = _v(f(*pre, min(1, u + du), v)) - _v(f(*pre, max(-1, u - du), v))
        pv = _v(f(*pre, u, min(1, v + du))) - _v(f(*pre, u, max(0, v - du)))
        n = pu.cross(pv).normalized()
        if n.z < 0:
            n = -n
        return p, pu.normalized(), n

    # ---- 屋面（板瓦面 + 底面 + 檐口立面）----
    for side in range(4):
        nu = NU_F if side % 2 == 0 else NU_S
        rows = [[lower(side, -1 + 2 * i / nu, j / NV) for i in range(nu + 1)] for j in range(NV + 1)]
        grid(rows, 'tile', g)
        under = [[(p[0], p[1], p[2] - t) for p in r] for r in rows]
        grid(under, 'wood', g)
        e0, e1 = rows[0], under[0]
        for i in range(nu):
            g.face([e1[i], e1[i + 1], e0[i + 1], e0[i]], 'ridge')     # 连檐
    for sign in ((-1, 1) if has_upper else ()):
        rows = [[upper(sign, -1 + 2 * i / NU_F, j / NV) for i in range(NU_F + 1)] for j in range(NV + 1)]
        grid(rows, 'tile', g)
        grid([[(p[0], p[1], p[2] - t) for p in r] for r in rows], 'wood', g)
        # 出际的两端封边
        for i in (0, NU_F):
            col = [r[i] for r in rows]
            for j in range(NV):
                p0, p1 = col[j], col[j + 1]
                g.face([p0, p1, (p1[0], p1[1], p1[2] - t), (p0[0], p0[1], p0[2] - t)], 'ridge')

    # ---- 山花板（缩进出际）与博缝板 ----
    for sx in ((-1, 1) if has_upper else ()):
        xg = sx * (W2 - a)
        prof = [upper(-1, sx, j / NV) for j in range(NV + 1)] + [upper(1, sx, j / NV) for j in range(NV, -1, -1)]
        pts = [(xg, p[1], p[2] - t) for p in prof]
        g.face(pts if sx > 0 else list(reversed(pts)), 'plaster')
        for sign in (-1, 1):
            for j in range(NV):
                p0, p1 = upper(sign, sx, j / NV), upper(sign, sx, (j + 1) / NV)
                g.add(bar((p0[0], p0[1], p0[2] - t - 0.15), (p1[0], p1[1], p1[2] - t - 0.15), 0.12, 0.55, 'vermilion'))
        # 博缝头的金色悬鱼
        g.add(box(0.12, 0.6, 1.1, 'gold', x=sx * XU, z=top - t - 1.3))

    # ---- 筒瓦垄与瓦当 ----
    R = 0.1

    def tile_row(f, pre, u, nseg=NV):
        pts = []
        for j in range(nseg + 1):
            v = j / nseg
            p, su, n = normal_at(f, *pre, u, v)
            pts.append((p + n * 0.03, su, n))
        ring_prev = None
        for p, su, n in pts:
            ring = [tuple(p + su * R * math.cos(th) + n * R * math.sin(th)) for th in (0, math.pi / 2, math.pi)]
            if ring_prev:
                for q in range(2):
                    g.face([ring_prev[q], ring_prev[q + 1], ring[q + 1], ring[q]], 'ridge')
            ring_prev = ring
        return pts[0]

    def wadang(p, su, n, out):
        """瓦当：筒瓦檐口端的圆形瓦头，面向外。"""
        c = p - out * 0.04
        disc = [tuple(c + su * (R + 0.02) * math.cos(th) + n * (R + 0.02) * math.sin(th)) for th in [i * math.pi / 4 for i in range(8)]]
        g.face(disc, 'ridge')

    for side in range(4):
        L = 2 * (W2 if side % 2 == 0 else D2)
        n_rows = max(4, int(L / tile_pitch))
        for i in range(n_rows):
            u = -1 + (i + 0.5) * 2 / n_rows
            p, su, n = tile_row(lower, (side,), u)
            e1 = _v(eave(side, u))
            e0 = _v(lower(side, u, 0.05))
            wadang(p, su, n, (e0 - e1).normalized())
    for sign in ((-1, 1) if has_upper else ()):
        n_rows = int(2 * XU / tile_pitch)
        for i in range(n_rows):
            tile_row(upper, (sign,), -1 + (i + 0.5) * 2 / n_rows)

    # ---- 椽头：檐檩下两排（飞椽、檐椽）----
    if rafters:
        for side in range(4):
            L = 2 * (W2 if side % 2 == 0 else D2)
            n_r = max(4, int(L / (tile_pitch * 1.2)))
            for i in range(n_r):
                u = -1 + (i + 0.5) * 2 / n_r
                # 椽子顺着屋面底面的坡度贴在下面：飞椽在外，檐椽在内且再低一层
                for v0, v1, drop, col in ((0.0, 0.1, 0.08, 'qing'), (0.07, 0.24, 0.24, 'wood')):
                    p0 = _v(lower(side, u, v0)) - Vector((0, 0, t + drop))
                    p1 = _v(lower(side, u, v1)) - Vector((0, 0, t + drop))
                    if v0 > 0:
                        p0 += (p1 - p0).normalized() * 0.05
                    g.add(bar(tuple(p0), tuple(p1), 0.13, 0.13, col))

    if kind == 'skirt':
        _hip_ridges(g, lower, NV, t, beasts=max(0, beasts - 2))
        return g

    # ---- 正脊 + 鸱吻 ----
    ridge_len = 2 * XU - 0.6 if has_upper else 2 * (W2 - a) + 0.4
    g.add(box(ridge_len, 0.55, 0.75, 'ridge', z=top - 0.05))
    g.add(box(ridge_len + 0.1, 0.7, 0.14, 'tile', z=top + 0.7))
    for sx in (-1, 1):
        x = sx * (ridge_len / 2 + 0.1)
        prof = [(-0.55, 0), (0.55, 0), (0.6, 0.9), (0.35, 1.7), (-0.05, 2.0), (-0.45, 1.75), (-0.2, 1.4), (-0.5, 0.9)]
        claw = extrude_xz([(px * -sx, pz) for px, pz in prof], 0.5, 'ridge')
        g.add(claw, t=(x, 0, top - 0.05))
        g.add(box(0.2, 0.55, 0.5, 'gold', x=x - sx * 0.25, z=top + 1.0))   # 剑把

    # ---- 垂脊（上段两坡外缘）----
    for sx in ((-1, 1) if has_upper else ()):
        for sign in (-1, 1):
            for j in range(NV):
                p0, p1 = upper(sign, sx, j / NV), upper(sign, sx, (j + 1) / NV)
                g.add(bar((p0[0] - sx * 0.25, p0[1], p0[2] + 0.18), (p1[0] - sx * 0.25, p1[1], p1[2] + 0.18), 0.4, 0.42, 'ridge'))
            p = upper(sign, sx, 0.02)
            g.add(box(0.45, 0.5, 0.75, 'ridge', x=p[0] - sx * 0.25, y=p[1], z=p[2] + 0.25))   # 垂兽

    _hip_ridges(g, lower, NV, t, beasts)
    return g


def _hip_ridges(g, lower, NV, t, beasts):
    """戗脊（下段四角）+ 翘起的脊端 + 套兽 + 仙人走兽。lower(side, u, v) 为下段屋面函数。"""
    for side in range(4):
        u = 1.0
        pts = [_v(lower(side, u, 1 - j / NV)) for j in range(NV + 1)]   # 从分界线到檐角
        for j in range(NV):
            g.add(bar(tuple(pts[j] + Vector((0, 0, 0.2))), tuple(pts[j + 1] + Vector((0, 0, 0.2))), 0.36, 0.4, 'ridge'))
        tip = pts[-1]
        prev = pts[-2]
        dirn = (tip - prev)
        dirn.z = 0
        dirn.normalize()
        g.add(bar(tuple(tip + Vector((0, 0, 0.2))), tuple(tip + dirn * 0.7 + Vector((0, 0, 0.75))), 0.3, 0.3, 'ridge'))   # 翘起的脊端
        g.add(box(0.26, 0.3, 0.26, 'gold', x=tip.x + dirn.x * 0.15, y=tip.y + dirn.y * 0.15, z=tip.z - 0.12))   # 套兽
        # 仙人与走兽：从脊端沿戗脊往里排，高度按折线插值
        rev = list(reversed(pts))                                          # 檐角 → 分界线
        cum = [0.0]
        for a, b in zip(rev, rev[1:]):
            cum.append(cum[-1] + (b - a).length)

        def along(s_):
            for k in range(len(rev) - 1):
                if cum[k + 1] >= s_:
                    f = (s_ - cum[k]) / max(1e-6, cum[k + 1] - cum[k])
                    return rev[k].lerp(rev[k + 1], f)
            return rev[-1]

        for n in range(beasts + 1):
            q = along(0.7 + n * 0.6)
            size = 0.32 if n else 0.38
            g.add(box(size * 0.7, size * 0.7, size * (1.3 if n == 0 else 1.0), 'ridge' if n else 'gold', x=q.x, y=q.y, z=q.z + 0.38))


def roof_xieshan_size(w, d, overhang=2.4):
    """供上层估算屋顶覆盖范围。"""
    return w + 2 * overhang, d + 2 * overhang


# ---------------------------------------------------------------------------
# 斗栱
# ---------------------------------------------------------------------------

def dougong_unit(corner=False):
    """一朵斗栱，坐在平板枋上（z=0），向 -Y 出挑约 1.6 米，总高约 1.35 米。"""
    g = Geo()
    g.add(box(0.62, 0.62, 0.32, 'qing', taper=0.07))                                   # 栌斗
    g.add(box(1.75, 0.24, 0.26, 'teal', z=0.32))                                       # 泥道栱
    for x in (-0.75, 0, 0.75):
        g.add(box(0.3, 0.3, 0.18, 'qing', x=x, z=0.58, taper=0.03))                    # 散斗
    g.add(box(0.24, 1.35, 0.26, 'teal', y=-0.55, z=0.32))                              # 头跳华栱
    g.add(box(0.32, 0.32, 0.18, 'qing', y=-1.15, z=0.58, taper=0.03))                  # 交互斗
    g.add(box(1.5, 0.22, 0.24, 'teal', y=-1.15, z=0.76))                               # 瓜栱
    for x in (-0.62, 0.62):
        g.add(box(0.28, 0.28, 0.16, 'qing', x=x, y=-1.15, z=1.0, taper=0.03))
    g.add(beam((0, 0.1, 1.05), (0, -1.75, 0.62), 0.12, 0.1, 'teal', seg=4))           # 昂
    g.add(box(0.2, 0.3, 0.14, 'gold', y=-1.78, z=0.52))                                # 昂嘴
    g.add(box(1.3, 0.22, 0.24, 'teal', y=-1.55, z=1.08))                               # 厢栱
    if corner:
        g.add(box(1.35, 0.24, 0.26, 'teal', x=0.55, z=0.32), rot=90)
    return g


def dougong_row(length, spacing, z, y, out_sign=-1):
    """沿 X 排一行斗栱（含柱头科、平身科），以及正心枋与挑檐枋两道通长枋。"""
    g = Geo()
    n = max(1, round(length / spacing))
    for i in range(n + 1):
        x = -length / 2 + i * length / n
        unit = dougong_unit()
        g.add(unit, t=(x, y, z), rot=0 if out_sign < 0 else 180)
    for zz in (0.62, 0.95):
        g.add(box(length + 0.6, 0.26, 0.28, 'teal', y=y, z=z + zz))                    # 正心枋
    g.add(box(length + 1.8, 0.3, 0.3, 'qing', y=y + out_sign * 1.55, z=z + 1.32))      # 挑檐枋
    return g


# ---------------------------------------------------------------------------
# 柱、额枋、雀替
# ---------------------------------------------------------------------------

def column(h, r=0.27):
    g = Geo()
    g.add(cyl(r * 1.6, 0.22, 'stone', seg=12))                                         # 柱础
    g.add(cyl(r * 1.3, 0.12, 'stone', z=0.22, seg=12, r_top=r * 1.15))                 # 鼓镜
    g.add(cyl(r, h - 0.34, 'vermilion', z=0.34, seg=12, r_top=r * 0.9))                # 柱身（收分）
    return g


def architrave(length, z, y, depth=0.34):
    """大额枋 + 由额垫板 + 小额枋，两端金色箍头，枋心青色。"""
    g = Geo()
    g.add(box(length, depth, 0.32, 'teal', y=y, z=z))                                  # 小额枋
    g.add(box(length - 0.1, depth * 0.6, 0.22, 'vermilion', y=y, z=z + 0.32))          # 垫板
    g.add(box(length, depth, 0.5, 'teal', y=y, z=z + 0.54))                            # 大额枋
    g.add(box(length * 0.6, depth + 0.02, 0.34, 'qing', y=y, z=z + 0.62))              # 枋心
    for sx in (-1, 1):
        g.add(box(0.18, depth + 0.03, 0.52, 'gold', x=sx * (length / 2 - 0.4), y=y, z=z + 0.53))   # 箍头
    g.add(box(length + 0.4, depth + 0.16, 0.18, 'teal', y=y, z=z + 1.04))              # 平板枋
    return g


def queti(y, z, out_sign=-1):
    """雀替：柱与额枋交角处的托木（左右各一）。"""
    g = Geo()
    for sx in (-1, 1):
        prof = [(0, 0), (sx * 1.1, 0), (sx * 0.9, -0.18), (sx * 0.3, -0.45), (0, -0.55)]
        piece = extrude_xz(prof if sx > 0 else list(reversed(prof)), 0.18, 'teal')
        g.add(piece, t=(0, y, z))
    return g


# ---------------------------------------------------------------------------
# 门窗
# ---------------------------------------------------------------------------

def _lattice(w, h, nx, nz, material='vermilion', bar_w=0.045):
    g = Geo()
    for i in range(1, nx):
        x = -w / 2 + i * w / nx
        g.add(box(bar_w, bar_w, h, material, x=x))
    for j in range(1, nz):
        g.add(box(w, bar_w, bar_w, material, z=j * h / nz))
    return g


def geshan_leaf(w, h):
    """隔扇门一扇（正面朝 -Y，底在 z=0）：边梃抹头、上部格心棂条、下部绦环板与裙板。"""
    g = Geo()
    f = 0.09
    for x in (-w / 2 + f / 2, w / 2 - f / 2):
        g.add(box(f, 0.1, h, 'vermilion', x=x))
    for z in (0, h * 0.36, h * 0.42, h - f):
        g.add(box(w, 0.1, f, 'vermilion', z=z))
    gx_h = h - f - h * 0.42 - f
    g.add(box(w - 2 * f, 0.03, gx_h, 'void', y=0.03, z=h * 0.42 + f))                  # 格心后的暗面（窗纸内的室内）
    lat = _lattice(w - 2 * f, gx_h, 4, 7)
    g.add(lat, t=(0, -0.01, h * 0.42 + f))
    g.add(box(w - 2 * f, 0.06, h * 0.06 - f, 'vermilion', y=0.01, z=h * 0.36 + f))     # 绦环板
    g.add(box(w - 2 * f, 0.06, h * 0.36 - f, 'vermilion', y=0.01, z=f))               # 裙板
    # 裙板上的描金线框（四根细金线围成方框）
    fw, fh, fz = w * 0.55, h * 0.18, h * 0.09
    for z in (fz, fz + fh):
        g.add(box(fw, 0.07, 0.03, 'gold', y=-0.01, z=z))
    for x in (-fw / 2, fw / 2):
        g.add(box(0.03, 0.07, fh, 'gold', x=x, y=-0.01, z=fz))
    return g


def bay_doors(bay_w, h, leaves=4):
    """一个开间的隔扇门：抱框、上中下槛、横披窗与四扇隔扇。"""
    g = Geo()
    g.add(box(0.16, 0.16, h, 'vermilion', x=-bay_w / 2 + 0.08))
    g.add(box(0.16, 0.16, h, 'vermilion', x=bay_w / 2 - 0.08))
    g.add(box(bay_w, 0.2, 0.22, 'vermilion'))                                          # 下槛
    door_h = h * 0.78
    g.add(box(bay_w, 0.16, 0.16, 'vermilion', z=door_h))                               # 中槛
    g.add(box(bay_w, 0.16, 0.16, 'vermilion', z=h - 0.16))                             # 上槛
    hp = h - door_h - 0.32                                                             # 横披窗
    g.add(box(bay_w - 0.32, 0.03, hp, 'void', y=0.04, z=door_h + 0.16))
    g.add(_lattice(bay_w - 0.32, hp, 8, 2), t=(0, -0.02, door_h + 0.16))
    lw = (bay_w - 0.32) / leaves
    for i in range(leaves):
        g.add(geshan_leaf(lw - 0.02, door_h - 0.22), t=(-bay_w / 2 + 0.16 + (i + 0.5) * lw, 0, 0.22))
    return g


def bay_windows(bay_w, h, sill=1.0):
    """槛窗：下部砖砌槛墙，上部四扇格心窗。"""
    g = Geo()
    g.add(box(bay_w, 0.5, sill, 'brick', y=0.15))
    g.add(box(bay_w + 0.06, 0.56, 0.08, 'stone', y=0.15, z=sill))
    win = bay_doors(bay_w, h - sill)
    g.add(win, t=(0, 0, sill + 0.08))
    return g


# ---------------------------------------------------------------------------
# 殿身（柱网 + 门窗 + 额枋 + 斗栱 + 屋顶）
# ---------------------------------------------------------------------------

def roof_gable2(w, d, h=None, overhang=0.9, gable='ying', tile_pitch=0.34, t=0.28, beasts=True, wall_mat='brick'):
    """两坡屋顶。w 为面阔、d 为进深（墙身外皮），底边（檐口下沿）在 z=0，正面朝 -Y。
    gable：'ying' 硬山（山墙封到屋面，带墀头）；'xuan' 悬山（屋面挑出山墙，博缝板封边）。
    举折上陡下缓；满铺筒瓦垄与瓦当；前后檐椽头；正脊两端望兽。"""
    g = Geo()
    h = h if h is not None else 0.42 * d
    ext = 0.15 if gable == 'ying' else 0.8           # 屋面在山面的挑出
    X2, D2 = w / 2 + ext, d / 2 + overhang
    top = t + h
    NV, NU = 6, max(8, int(w / 1.2))

    def slope(sign, u, v):
        z = t + h * v ** 1.45
        return (u * X2, sign * D2 * (1 - v), z)

    for sign in (-1, 1):
        rows = [[slope(sign, -1 + 2 * i / NU, j / NV) for i in range(NU + 1)] for j in range(NV + 1)]
        grid(rows, 'tile', g)
        grid([[(p[0], p[1], p[2] - t) for p in r] for r in rows], 'wood', g)
        e0 = rows[0]
        for i in range(NU):
            a, b = e0[i], e0[i + 1]
            g.face([(a[0], a[1], a[2] - t), (b[0], b[1], b[2] - t), b, a], 'ridge')
        for i in (0, NU):
            col = [r[i] for r in rows]
            for j in range(NV):
                p0, p1 = col[j], col[j + 1]
                g.face([p0, p1, (p1[0], p1[1], p1[2] - t), (p0[0], p0[1], p0[2] - t)], 'ridge')
        # 筒瓦垄与瓦当
        n_rows = max(4, int(2 * X2 / tile_pitch))
        R = 0.09
        for i in range(n_rows):
            u = -1 + (i + 0.5) * 2 / n_rows
            prev = None
            for j in range(NV + 1):
                v = j / NV
                pc = _v(slope(sign, u, v))
                pv = _v(slope(sign, u, min(1, v + 0.01))) - _v(slope(sign, u, max(0, v - 0.01)))
                su = Vector((1, 0, 0))
                n = su.cross(pv).normalized()
                if n.z < 0:
                    n = -n
                c = pc + n * 0.03
                ring = [tuple(c + su * R * math.cos(th) + n * R * math.sin(th)) for th in (0, math.pi / 2, math.pi)]
                if prev:
                    for q in range(2):
                        g.face([prev[q], prev[q + 1], ring[q + 1], ring[q]], 'ridge')
                else:
                    disc = [tuple(c + su * (R + 0.02) * math.cos(th) + n * (R + 0.02) * math.sin(th)) for th in [k * math.pi / 4 for k in range(8)]]
                    g.face(disc, 'ridge')
                prev = ring
        # 椽头
        n_r = max(4, int(2 * (w / 2) / 0.45))
        for i in range(n_r):
            x = -w / 2 + (i + 0.5) * w / n_r
            p0 = _v(slope(sign, x / X2, 0.0)) - Vector((0, 0, t + 0.07))
            p1 = _v(slope(sign, x / X2, 0.14)) - Vector((0, 0, t + 0.07))
            g.add(bar(tuple(p0), tuple(p1), 0.11, 0.11, 'wood'))
    # 正脊与望兽
    g.add(box(2 * X2 - 0.2, 0.45, 0.55, 'ridge', z=top - 0.05))
    g.add(box(2 * X2 - 0.1, 0.58, 0.1, 'tile', z=top + 0.5))
    if beasts:
        for sx in (-1, 1):
            prof = [(-0.35, 0), (0.35, 0), (0.38, 0.6), (0.2, 1.05), (-0.1, 1.15), (-0.32, 0.95), (-0.18, 0.7)]
            g.add(extrude_xz([(px * -sx, pz) for px, pz in prof], 0.38, 'ridge'), t=(sx * (X2 - 0.35), 0, top - 0.05))
    # 山面
    for sx in (-1, 1):
        if gable == 'ying':
            prof = [(-(d / 2 + 0.25), -0.2)] + [(slope(-1, 1, j / NV)[1] * (d / 2 + 0.25) / D2, slope(-1, 1, j / NV)[2] - t * 0.3) for j in range(NV + 1)] + \
                   [(slope(1, 1, j / NV)[1] * (d / 2 + 0.25) / D2, slope(1, 1, j / NV)[2] - t * 0.3) for j in range(NV, -1, -1)] + [((d / 2 + 0.25), -0.2)]
            pts = [(sx * (w / 2 + 0.05), y, z) for y, z in prof]
            g.face(pts if sx > 0 else list(reversed(pts)), wall_mat)
            for sy in (-1, 1):                                      # 墀头
                g.add(box(0.55, 0.6, 0.8, 'brick_light', x=sx * (w / 2 - 0.05), y=sy * (d / 2 + 0.05), z=-0.6))
                g.add(box(0.65, 0.7, 0.14, 'tile', x=sx * (w / 2 - 0.05), y=sy * (d / 2 + 0.05), z=0.2))
        else:
            for sign in (-1, 1):
                for j in range(NV):
                    p0, p1 = slope(sign, sx, j / NV), slope(sign, sx, (j + 1) / NV)
                    g.add(bar((p0[0], p0[1], p0[2] - t - 0.12), (p1[0], p1[1], p1[2] - t - 0.12), 0.1, 0.45, 'wood'))
    return g


def railing(length, h=1.05, material='vermilion', post_gap=1.6):
    """木栏杆（沿 X，居中）：望柱、寻杖、腰枋、下枋与竖向栏条。"""
    g = Geo()
    n = max(1, round(length / post_gap))
    for i in range(n + 1):
        x = -length / 2 + i * length / n
        g.add(box(0.16, 0.16, h + 0.15, material, x=x))
        g.add(box(0.2, 0.2, 0.1, 'gold', x=x, z=h + 0.15))
    for z, hh in ((h - 0.08, 0.08), (h * 0.55, 0.06), (0.08, 0.08)):
        g.add(box(length, 0.1, hh, material, z=z))
    m = int(length / 0.22)
    for i in range(m):
        g.add(box(0.035, 0.04, h * 0.45, material, x=-length / 2 + (i + 0.5) * length / m, z=h * 0.1))
    return g


def railing_ring(w, d, z, inset=0.15, gap_front=0.0, **kw):
    g = Geo()
    if gap_front > 0:
        seg = (w - gap_front) / 2
        for sx in (-1, 1):
            g.add(railing(seg, **kw), t=(sx * (gap_front / 2 + seg / 2), -d / 2 + inset, z))
    else:
        g.add(railing(w, **kw), t=(0, -d / 2 + inset, z))
    g.add(railing(w, **kw), t=(0, d / 2 - inset, z))
    for sx in (-1, 1):
        g.add(railing(d, **kw), t=(sx * (w / 2 - inset), 0, z), rot=90)
    return g


def _story(g, bays_x, bays_y, col_h, z0, front, back, sides, outer_cols=True, dougong=True):
    """一层殿身：柱、前后檐装修、山墙、额枋、雀替、四面斗栱。返回 (W, D, 斗栱顶面高度)。"""
    W, D = sum(bays_x), sum(bays_y)
    xs = [-W / 2]
    for b in bays_x:
        xs.append(xs[-1] + b)
    ys = [-D / 2]
    for b in bays_y:
        ys.append(ys[-1] + b)
    for x in xs:
        for y in ys:
            if x in (xs[0], xs[-1]) or y in (ys[0], ys[-1]):
                g.add(column(col_h), t=(x, y, z0))
    for i, b in enumerate(bays_x):
        cx = (xs[i] + xs[i + 1]) / 2
        for y, kind in ((ys[0], front), (ys[-1], back)):
            sgn = -1 if y < 0 else 1
            if kind == 'doors':
                piece = bay_doors(b - 0.5, col_h - 0.9)
            elif kind == 'windows':
                piece = bay_windows(b - 0.5, col_h - 0.9)
            elif kind == 'door_center':
                piece = bay_doors(b - 0.5, col_h - 0.9) if i == len(bays_x) // 2 else bay_windows(b - 0.5, col_h - 0.9)
            elif kind == 'open':
                continue
            else:
                piece = Geo().add(box(b - 0.5, 0.45, col_h - 0.9, 'plaster'))
            g.add(piece, t=(cx, y, z0), rot=0 if sgn < 0 else 180)
    for x in (xs[0], xs[-1]):
        for j, b in enumerate(bays_y):
            cy = (ys[j] + ys[j + 1]) / 2
            if sides == 'windows':
                g.add(bay_windows(b - 0.5, col_h - 0.9), t=(x, cy, z0), rot=90 if x > 0 else -90)
            elif sides != 'open':
                g.add(box(0.5, b - 0.5, 1.1, 'brick', x=x, y=cy, z=z0))
                g.add(box(0.42, b - 0.5, col_h - 2.0, 'plaster', x=x, y=cy, z=z0 + 1.1))
    zb = z0 + col_h - 1.1
    for y in (ys[0], ys[-1]):
        g.add(architrave(W + 0.3, zb, y))
    for x in (xs[0], xs[-1]):
        g.add(architrave(D + 0.3, zb, 0), t=(x, 0, 0), rot=90)
    for x in xs:
        for y in (ys[0], ys[-1]):
            g.add(queti(0, 0), t=(x, y - 0.02 * (1 if y < 0 else -1), zb))
    zd = zb + 1.22
    if not dougong:                                                     # 小式：无斗栱，檐檩 + 垫板直接承椽
        for y in (ys[0], ys[-1]):
            g.add(box(W + 0.5, 0.36, 0.36, 'wood', y=y, z=zd - 0.1))
        for x in (xs[0], xs[-1]):
            g.add(box(0.36, D + 0.5, 0.36, 'wood', x=x, z=zd - 0.1))
        return W, D, zd + 0.26
    nx, ny = max(1, len(bays_x)), max(1, len(bays_y))
    g.add(dougong_row(W, W / (nx * 2), zd, ys[0], -1))
    g.add(dougong_row(W, W / (nx * 2), zd, ys[-1], 1))
    g.add(dougong_row(D, D / (ny * 2), zd, 0, -1), t=(xs[-1], 0, 0), rot=90)
    g.add(dougong_row(D, D / (ny * 2), zd, 0, -1), t=(xs[0], 0, 0), rot=-90)
    return W, D, zd + 1.35


def hall2(bays_x=(4.6, 5.2, 4.6), bays_y=(4.5, 4.5), col_h=4.6, front='doors', back='windows', sides='wall',
          base_h=0.6, base_mat='stone', roof_h=None, lanterns=True, roof_kind='xieshan', stories=1,
          double=False, gallery=0.0, shrink=0.86, upper_front='doors', front_steps=False, beasts=3, dougong=True):
    """木构殿 / 城楼 / 楼阁，正面朝 -Y。
    bays_x、bays_y：各开间、进深间宽度（米）；stories：层数（上层按 shrink 收分，层间做腰檐 + 平座栏杆）；
    gallery：底层外圈回廊深度（>0 时回廊柱上另起一道下檐，形成重檐）；double：顶层加一道下檐（重檐）；
    roof_kind：'xieshan' 歇山、'wudian' 庑殿、'ying' / 'xuan' 两坡。"""
    g = Geo()
    W0, D0 = sum(bays_x), sum(bays_y)
    gw = W0 + 2 * gallery
    gd = D0 + 2 * gallery
    # 台明：阶条石压边、方砖地面
    g.add(box(gw + 2.6, gd + 2.6, base_h, base_mat))
    g.add(box(gw + 2.7, gd + 2.7, 0.16, 'marble', z=base_h - 0.16))
    g.add(box(gw + 2.4, gd + 2.4, 0.04, 'brick_light', z=base_h))
    if front_steps and base_h > 0.3:
        g.add(kit.stair(min(5.0, W0 * 0.35), base_h * 2.6, base_h), t=(0, -(gd + 2.6) / 2 - base_h * 1.3, 0))
        for sx in (-1, 1):
            g.add(extrude_xz([(0, 0), (base_h * 2.6, 0), (0, base_h)], 0.4, 'marble'),
                  t=(sx * (min(5.0, W0 * 0.35) / 2 + 0.2), -(gd + 2.6) / 2, 0), rot=90)
    z0 = base_h + 0.04
    bx, by = list(bays_x), list(bays_y)
    eave_inset = 3.1 if dougong else 1.6
    for s in range(stories):
        last = s == stories - 1
        ch = col_h if s == 0 else col_h * 0.82
        if gallery > 0 and s == 0:
            # 回廊：外圈矮柱 + 额枋 + 斗栱，上起下檐；内圈柱加高，殿身在里
            _, _, zg = _story(g, [gw / max(1, len(bx) + 2)] * (len(bx) + 2), [gd / max(1, len(by) + 2)] * (len(by) + 2), ch, z0, 'open', 'open', 'open', dougong=dougong)
            inner_h = ch + 3.2
            W, D, zr = _story(g, bx, by, inner_h, z0, front, back, sides, dougong=dougong)
            g.add(roof_hip(gw + eave_inset, gd + eave_inset, kind='skirt', inner=(W + 0.6, D + 0.6), h=zr - zg - 1.9, overhang=1.0,
                           lift=0.8, push=0.6, beasts=beasts), t=(0, 0, zg))
        else:
            if double and last:
                ch += 2.2
            W, D, zr = _story(g, bx, by, ch, z0, front if s == 0 else upper_front, back, sides, dougong=dougong)
            if double and last:
                g.add(roof_hip(W + eave_inset, D + eave_inset, kind='skirt', inner=(W + 0.6, D + 0.6), h=1.7, overhang=1.0,
                               lift=0.8, push=0.6, beasts=beasts), t=(0, 0, z0 + ch - 2.2 - 0.3))
        if lanterns and s == 0:
            xs = [-W / 2 + sum(bx[:i]) for i in range(1, len(bx))]
            for x in xs:
                g.add(lantern(drop=0.5), t=(x, -D / 2 - gallery - 2.2, zr - 0.35))
        if not last:
            # 腰檐 + 平座（楼面外挑一圈，木栏杆）
            nW, nD = W * shrink, D * shrink
            g.add(roof_hip(W + eave_inset, D + eave_inset, kind='skirt', inner=(nW + 1.4, nD + 1.4), h=1.3, overhang=0.9,
                           lift=0.7, push=0.5, beasts=1), t=(0, 0, zr))
            zf = zr + 1.6
            g.add(box(nW + 2.2, nD + 2.2, 0.3, 'wood', z=zf))
            g.add(railing_ring(nW + 2.0, nD + 2.0, zf + 0.3, gap_front=0))
            bx = [b * shrink for b in bx]
            by = [b * shrink for b in by]
            z0 = zf + 0.3
            continue
        # 顶层屋顶
        if roof_kind in ('xieshan', 'wudian'):
            g.add(roof_hip(W + eave_inset, D + eave_inset, kind=roof_kind, h=roof_h, overhang=1.2, beasts=beasts), t=(0, 0, zr))
        else:
            g.add(roof_gable2(W + 0.6, D + eave_inset, h=roof_h, overhang=0.6, gable=roof_kind), t=(0, 0, zr))
    return g


def wall_corner2(len_a=24.0, len_b=24.0, height=8.0, **kw):
    """城墙外转角（L 形）：一段沿 +X、一段沿 +Y，转角在原点，外侧分别朝 -Y、-X；转角处加方形角台。"""
    g = Geo()
    g.add(wall2(len_a, height, **kw), t=(len_a / 2, 0, 0))
    g.add(wall2(len_b, height, **kw), t=(0, len_b / 2, 0), rot=-90)
    return g


# ---------------------------------------------------------------------------
# 城门城台
# ---------------------------------------------------------------------------

def band(w, d, z, h, depth, material, gap=0.0):
    """贴着 w × d 矩形外缘的一圈带（基座、腰线）；gap > 0 时前后两面正中断开，留出门洞。"""
    g = Geo()
    for sy in (-1, 1):
        y = sy * (d / 2 - depth / 2)
        if gap > 0:
            seg = (w - gap) / 2
            for sx in (-1, 1):
                g.add(box(seg, depth, h, material, x=sx * (gap / 2 + seg / 2), y=y, z=z))
        else:
            g.add(box(w, depth, h, material, y=y, z=z))
    for sx in (-1, 1):
        g.add(box(depth, d - 2 * depth, h, material, x=sx * (w / 2 - depth / 2), z=z))
    return g


def gate_doors(aw, ah, spring, depth_y):
    """城门门扇：两扇对开，满布门钉（9 × 9），铺首衔环，门簪两枚；拱形门额以朱红板封。"""
    g = Geo()
    lw = aw / 2 - 0.05
    hh = spring
    for sx in (-1, 1):
        cx = sx * (lw / 2 + 0.03)
        g.add(box(lw, 0.28, hh, 'vermilion', x=cx, y=depth_y))
        for i in range(9):
            for j in range(9):
                x = cx - lw / 2 + 0.3 + i * (lw - 0.6) / 8
                z = 0.4 + j * (hh - 0.8) / 8
                g.add(beam((x, depth_y - 0.14, z), (x, depth_y - 0.22, z), 0.07, 0.05, 'gold', seg=6))
        g.add(beam((cx - sx * (lw / 2 - 0.45), depth_y - 0.14, hh * 0.45), (cx - sx * (lw / 2 - 0.45), depth_y - 0.25, hh * 0.45), 0.22, 0.2, 'gold', seg=8))  # 铺首
        g.add(box(0.5, 0.45, 0.45, 'stone', x=sx * (aw / 2 - 0.15), y=depth_y + 0.3))   # 门枕石
    # 拱形门额封板
    r = aw / 2
    arc = [(-r, spring)] + [(-r * math.cos(math.pi * k / 12), spring + r * math.sin(math.pi * k / 12)) for k in range(1, 12)] + [(r, spring)]
    g.add(extrude_xz(arc, 0.2, 'vermilion', y=depth_y + 0.05))
    for sx in (-1, 1):
        g.add(beam((sx * 0.8, depth_y - 0.05, spring + 0.45), (sx * 0.8, depth_y - 0.45, spring + 0.45), 0.16, 0.16, 'gold', seg=8))  # 门簪
    return g


def merlons2(length, z, y, out_sign=-1, w=1.25, h=1.7, gap=0.9, thick=0.62):
    """垛口：每个垛子带望孔，垛口下的宇墙带射孔，顶上瓦帽。"""
    g = Geo()
    n = max(1, int((length + gap) // (w + gap)))
    span = n * w + (n - 1) * gap
    x0 = -span / 2 + w / 2
    for i in range(n):
        x = x0 + i * (w + gap)
        g.add(box(w, thick, h, 'brick', x=x, y=y, z=z + 0.6))
        g.add(box(w + 0.16, thick + 0.16, 0.18, 'tile', x=x, y=y, z=z + 0.6 + h))
        g.add(box(0.22, thick + 0.04, 0.3, 'void', x=x, y=y, z=z + 0.6 + h * 0.55))      # 望孔
        if i < n - 1:
            gx = x + (w + gap) / 2
            g.add(box(0.3, thick + 0.04, 0.22, 'void', x=gx, y=y, z=z + 0.2))            # 射孔
    g.add(box(span + 0.2, thick, 0.6, 'brick', y=y, z=z))                              # 垛墙下段
    return g


def spouts(length, z, y, out_sign=-1, every=6.0):
    """城台 / 城墙顶边外侧的石吐水嘴。"""
    g = Geo()
    n = max(1, int(length // every))
    for i in range(n):
        x = -length / 2 + (i + 0.5) * length / n
        g.add(beam((x, y, z), (x, y + out_sign * 0.45, z), 0.14, 0.11, 'stone', seg=4))
    return g


def gate_platform2(w, d, h, aw, ah, batter=0.09, tablet=True, parapet='merlons'):
    """城台：石条基座、砖砌台身（收分）、贯通门洞与拱券、门扇门钉、门额匾、顶边吐水嘴与四周垛口。"""
    g = Geo()
    arch = aw is not None
    aw0 = aw if arch else 0.0
    g.add(kit.platform(w, d, h, batter=batter, arch=(aw, ah) if arch else None, arch_ring=0.75, base=False))
    g.add(band(w + 0.5, d + 0.5, 0.0, 1.0, 0.6, 'stone', gap=aw0))                     # 石条基座
    g.add(band(w + 0.62, d + 0.62, 1.0, 0.12, 0.66, 'stone', gap=aw0))
    zz = h * 0.42                                                                       # 腰线砖（门洞上方断开）
    ins = batter * zz
    g.add(band(w - 2 * ins + 0.18, d - 2 * ins + 0.18, zz, 0.16, 0.3, 'brick_light', gap=aw0 if arch and zz < ah else 0))
    if arch:
        r = aw / 2
        spring = max(0.0, ah - r)
        g.add(gate_doors(aw, ah, spring, -d / 2 + 2.4))
    if tablet:
        zp = ah + 1.0 if arch else h * 0.68
        yf = -(d / 2 - batter * zp) - 0.12
        g.add(box(3.8, 0.24, 1.6, 'gold', y=yf, z=zp))
        g.add(box(3.4, 0.3, 1.25, 'qing', y=yf, z=zp + 0.18))
    ins = batter * h
    tw, td = w - 2 * ins, d - 2 * ins
    if parapet == 'merlons':
        g.add(merlons2(tw - 0.8, h, -td / 2 + 0.31))
        g.add(merlons2(tw - 0.8, h, td / 2 - 0.31, h=0.9), rot=0)
        for sx in (-1, 1):
            g.add(merlons2(td - 2.0, h, 0, h=0.9), t=(sx * (tw / 2 - 0.31), 0, 0), rot=90)
    elif parapet == 'balustrade':
        g.add(box(tw + 0.3, td + 0.3, 0.25, 'marble', z=h - 0.22))
        g.add(stone_balustrade_ring(tw, td, h, inset=0.3))
    g.add(spouts(tw - 2, h - 0.15, -td / 2))
    g.add(box(tw - 0.4, td - 0.4, 0.06, 'brick_light', z=h))                           # 台顶海墁
    return g


def wall2(length=40, height=8, top_w=4.8, bottom_w=9.6, out_sign=-1):
    """城墙 v2：石条基、砖砌收分墙身、腰线、外侧垛口（望孔、射孔、瓦帽）、内侧宇墙、吐水嘴。外侧朝 -Y。"""
    g = Geo()
    L, H = length, height
    y_in = bottom_w / 2
    y_out_top = y_in - top_w
    bottom = [(-L / 2, -y_in, 0), (L / 2, -y_in, 0), (L / 2, y_in, 0), (-L / 2, y_in, 0)]
    top = [(-L / 2, y_out_top, H), (L / 2, y_out_top, H), (L / 2, y_in, H), (-L / 2, y_in, H)]
    g.add(prism(bottom, top, 'brick', top_mat='brick_light'))
    g.add(box(L, 0.5, 1.0, 'stone', y=-y_in - 0.05))                                   # 外侧石条基
    zz = H * 0.42
    yz = -y_in + (y_out_top + y_in) * zz / H
    g.add(box(L, 0.2, 0.16, 'brick_light', y=yz - 0.05, z=zz))
    g.add(merlons2(L, H, y_out_top + 0.31))
    g.add(box(L, 0.45, 1.0, 'brick', y=y_in - 0.23, z=H))                              # 宇墙
    g.add(box(L + 0.1, 0.65, 0.16, 'tile', y=y_in - 0.23, z=H + 1.0))
    g.add(spouts(L, H - 0.15, y_out_top))
    return g


def ramp(length, rise, width=3.0, steps=True):
    """马道：沿 +X 升起的坡道，底端在 x=-length/2，坡面上做礓磋（横向小台阶），外侧护墙。"""
    g = Geo()
    L = length
    pts_b = [(-L / 2, -width / 2, 0), (L / 2, -width / 2, 0), (L / 2, width / 2, 0), (-L / 2, width / 2, 0)]
    pts_t = [(-L / 2, -width / 2, 0.01), (L / 2, -width / 2, rise), (L / 2, width / 2, rise), (-L / 2, width / 2, 0.01)]
    g.add(prism(pts_b, pts_t, 'brick', top_mat='brick_light'))
    if steps:
        n = int(L / 0.6)
        for i in range(n):
            x = -L / 2 + (i + 0.5) * L / n
            z = rise * (x + L / 2) / L
            g.add(box(0.12, width - 0.6, 0.06, 'stone', x=x, z=z))
    # 外侧护墙（随坡）
    for i in range(6):
        x0 = -L / 2 + i * L / 6
        x1 = x0 + L / 6
        z0, z1 = rise * i / 6, rise * (i + 1) / 6
        g.add(extrude_xz([(x0, z0), (x1, z1), (x1, z1 + 1.0), (x0, z0 + 1.0)], 0.4, 'brick', y=-width / 2 + 0.2))
    return g


# ---------------------------------------------------------------------------
# 民居与瓮城
# ---------------------------------------------------------------------------

def wall_openings(length, h, thick, openings, material='plaster', dado=0.9, dado_mat='brick'):
    """沿 X 的一堵墙（居中，底 z=0），按 openings=[(x 中心, 宽, z 底, z 顶)] 留洞；下部砖砌墙裙。"""
    g = Geo()
    cuts = sorted(openings)
    xs = [-length / 2]
    for x, w, _, _ in cuts:
        xs += [x - w / 2, x + w / 2]
    xs.append(length / 2)
    for i in range(0, len(xs), 2):                                                  # 洞与洞之间的整墙
        x0, x1 = xs[i], xs[i + 1]
        if x1 - x0 > 0.01:
            g.add(box(x1 - x0, thick, dado, dado_mat, x=(x0 + x1) / 2))
            g.add(box(x1 - x0, thick - 0.06, h - dado, material, x=(x0 + x1) / 2, z=dado))
    for x, w, z0, z1 in cuts:                                                       # 洞口上下
        if z0 > 0.01:
            g.add(box(w, thick, min(z0, dado), dado_mat, x=x))
            if z0 > dado:
                g.add(box(w, thick - 0.06, z0 - dado, material, x=x, z=dado))
        g.add(box(w, thick - 0.06, h - z1, material, x=x, z=z1))
        g.add(box(w + 0.3, thick + 0.12, 0.22, 'stone' if z0 < 0.01 else 'wood', x=x, z=z1))   # 过梁
    return g


def matou2(length=8.0, steps=2, height=7.0, thick=0.5, material='plaster'):
    """马头墙 v2（沿 X）：阶梯山墙，每级压两坡小瓦檐 + 檐下砖线，顶端翘起的座头。"""
    g = Geo()
    n = steps
    step_len = length / (2 * n + 1)
    step_h = height * 0.15
    tops = []
    x = -length / 2
    for i in range(2 * n + 1):
        lvl = min(i, 2 * n - i)
        z = height - (n - lvl) * step_h
        tops.append((x, x + step_len, z))
        x += step_len
    prof = [(-length / 2, 0)]
    for x0, x1, z in tops:
        prof += [(x0, z), (x1, z)]
    prof.append((length / 2, 0))
    g.add(extrude_xz(list(reversed(prof)), thick, material))
    g.add(box(length + 0.02, thick + 0.04, 0.9, 'brick'))
    for x0, x1, z in tops:
        L = x1 - x0 + 0.3
        g.add(box(L, thick + 0.16, 0.1, 'brick_light', x=(x0 + x1) / 2, z=z - 0.1))
        for sy in (-1, 1):
            g.add(bar(((x0 + x1) / 2 - L / 2, 0, z + 0.32), ((x0 + x1) / 2 + L / 2, 0, z + 0.32), 0.1, 0.1, 'ridge'), t=(0, 0, 0))
            g.add(extrude_xz([(x0 - 0.15, z), (x1 + 0.15, z), (x1 + 0.15, z + 0.08), (x0 - 0.15, z + 0.08)], 0.42, 'tile',
                             y=sy * (thick / 2 + 0.12)))
        g.add(box(L, 0.24, 0.34, 'ridge', x=(x0 + x1) / 2, z=z + 0.02))
    for x0, x1, z in (tops[0], tops[-1]):                                            # 座头
        xe = x0 - 0.1 if x0 < 0 else x1 + 0.1
        sgn = -1 if x0 < 0 else 1
        g.add(extrude_xz([(xe - sgn * 0.3, z), (xe, z), (xe + sgn * 0.25, z + 0.7), (xe - sgn * 0.05, z + 0.55)], 0.3, 'ridge'))
    return g


def house2(w=11.0, d=7.0, eave_h=4.0, roof_h=None, gable='matou', steps=2, door='center', windows=2,
           wall_mat='plaster', porch=False, tile_pitch=0.4):
    """民居 v2（正面朝 -Y）：墙身留洞装木门（实榻门 / 隔扇）与格心窗；砖墙裙、阶条石台基；
    硬山两坡瓦顶（筒瓦垄、正脊望兽）；gable='matou' 两山做马头墙，'ying' 为硬山封檐，'xuan' 为悬山。
    porch=True 时前檐退进一步架做廊，露出檐柱。door='shop' 为临街铺面：整间敞开、柜台、两侧叠放的排门板。"""
    g = Geo()
    th = 0.42
    g.add(box(w + 1.2, d + 1.4, 0.35, 'stone'))
    g.add(box(w + 1.0, d + 1.2, 0.04, 'brick_light', z=0.35))
    z0 = 0.39
    fy = -d / 2 + (1.4 if porch else 0)
    dw, dh = 1.9, min(2.9, eave_h - 0.9)
    ops = []
    if door == 'center':
        ops.append((0.0, dw, 0.0, dh))
    if door == 'shop':
        ops.append((0.0, w - 1.6, 0.0, eave_h - 0.8))
        windows = 0
    if windows:
        for k in range(windows):
            x = (-1 if k % 2 == 0 else 1) * w * (0.24 + 0.17 * (k // 2))
            ops.append((x, 1.5, 1.1, 2.6))
    body = Geo()
    body.add(wall_openings(w, eave_h, th, ops, wall_mat), t=(0, fy + th / 2, 0))
    body.add(box(w, th, eave_h, wall_mat, y=d / 2 - th / 2))
    body.add(box(w, th, 0.9, 'brick', y=d / 2 - th / 2 - 0.01))
    for sx in (-1, 1):
        body.add(box(th, d - th - (1.4 if porch else 0) + th, eave_h, wall_mat, x=sx * (w / 2 - th / 2), y=(fy + d / 2) / 2))
    body.add(box(w - 2 * th, d - (1.4 if porch else 0) - 2 * th, 0.06, 'brick_light', y=(fy + d / 2) / 2))
    for x, ow, zb, zt in ops:
        if door == 'shop':                                                           # 铺面：暗面、柜台、排门板、檐下横楣
            body.add(box(ow, 0.05, zt, 'void', y=fy + 1.6))
            body.add(box(ow * 0.55, 0.7, 0.95, 'wood', x=-ow * 0.12, y=fy + 0.6))
            body.add(box(ow * 0.55 + 0.1, 0.8, 0.06, 'trunk', x=-ow * 0.12, y=fy + 0.6, z=0.95))
            for k in range(6):
                body.add(box(0.36, 0.06, zt - 0.3, 'vermilion', x=ow / 2 - 0.25 - k * 0.07, y=fy + 0.3 + k * 0.08, z=0.15))
            body.add(box(ow, 0.2, 0.3, 'wood', y=fy, z=zt - 0.3))
            body.add(box(ow, 0.24, 0.12, 'wood', y=fy))
            continue
        if zb < 0.01:                                                                # 门：门框 + 两扇实榻门 + 门簪 + 门槛
            for sx in (-1, 1):
                body.add(box(0.14, 0.24, zt, 'wood', x=x + sx * (ow / 2 - 0.07), y=fy))
                leaf = box(ow / 2 - 0.16, 0.08, zt - 0.3, 'vermilion', x=x + sx * (ow / 4 - 0.02), y=fy + 0.12, z=0.22)
                body.add(leaf)
                for zz in (0.6, zt - 0.6):
                    body.add(box(0.05, 0.06, 0.12, 'ink', x=x + sx * 0.12, y=fy + 0.06, z=zz))
                body.add(box(0.16, 0.16, 0.16, 'gold', x=x + sx * 0.35, y=fy - 0.04, z=zt + 0.03))          # 门簪
            body.add(box(ow, 0.3, 0.22, 'stone', y=fy))
            for sx in (-1, 1):
                body.add(box(0.4, 0.55, 0.5, 'stone', x=x + sx * (ow / 2 + 0.2), y=fy - 0.12))   # 门枕石
        else:                                                                        # 窗：窗框 + 格心棂条 + 暗面
            body.add(box(ow, 0.03, zt - zb, 'void', y=fy + th * 0.6, z=zb))
            body.add(_lattice(ow, zt - zb, 6, 6, 'wood', 0.05), t=(x, fy + th * 0.3, zb))
            body.add(box(ow + 0.2, th + 0.1, 0.1, 'stone', x=x, y=fy + th / 2, z=zb - 0.1))
    g.add(body, t=(0, 0, z0))
    if porch:
        for i in range(4):
            x = -w / 2 + 0.25 + i * (w - 0.5) / 3
            g.add(column(eave_h - 0.1, r=0.18), t=(x, -d / 2 + 0.3, z0))
        g.add(box(w, 0.26, 0.4, 'wood', y=-d / 2 + 0.3, z=z0 + eave_h - 0.5))
    rh = roof_h if roof_h is not None else 0.42 * d
    g.add(roof_gable2(w, d, h=rh, overhang=0.75, gable='ying' if gable == 'matou' else gable, beasts=gable != 'matou',
                      wall_mat=wall_mat, tile_pitch=tile_pitch), t=(0, 0, z0 + eave_h - 0.05))
    if gable == 'matou':
        for sx in (-1, 1):
            g.add(matou2(d + 1.2, steps, eave_h + rh + 1.6, 0.5, wall_mat), t=(sx * (w / 2 + 0.26), 0, z0), rot=90)
    return g


def enclosure2(w, d, h=3.4, thick=0.7, gates=None, material='plaster'):
    """院墙 v2：砖砌下碱、粉墙或红墙墙身、墙帽（两坡小瓦檐 + 脊）。gates 同 kit.enclosure：[(边, 偏移, 门宽)]。"""
    g = Geo()
    gates = gates or []
    sides = {'S': (w, (0, -d / 2), 0), 'N': (w, (0, d / 2), 0), 'E': (d, (w / 2, 0), 90), 'W': (d, (-w / 2, 0), 90)}
    for side, (length, (cx, cy), rot) in sides.items():
        L = length + (thick if side in 'SN' else -thick)
        cuts = sorted((off - gw / 2, off + gw / 2) for s_, off, gw in gates if s_ == side)
        pieces, start = [], -L / 2
        for a, b in cuts:
            if a > start:
                pieces.append((start, a))
            start = max(start, b)
        if start < L / 2:
            pieces.append((start, L / 2))
        for a, b in pieces:
            seg = Geo()
            m, n = (a + b) / 2, b - a
            seg.add(box(n, thick + 0.06, 0.9, 'brick', x=m))
            seg.add(box(n, thick, h - 0.9, material, x=m, z=0.9))
            seg.add(box(n, thick + 0.14, 0.12, 'brick_light', x=m, z=h - 0.12))
            for sy in (-1, 1):
                seg.add(extrude_xz([(a - 0.1, 0), (b + 0.1, 0), (b + 0.1, 0.07), (a - 0.1, 0.07)], 0.5, 'tile',
                                   y=sy * (thick / 2 + 0.05)), t=(0, 0, h + 0.05))
            seg.add(box(n + 0.1, 0.3, 0.32, 'ridge', x=m, z=h))
            seg.add(box(n + 0.1, thick * 0.7, 0.14, 'tile', x=m, z=h))
            for k in (a, b):                                          # 墙垛头
                seg.add(box(0.2, thick + 0.12, h - 0.9, 'brick', x=k + (0.1 if k == a else -0.1), z=0.9))
            g.add(seg, t=(cx, cy, 0), rot=rot)
    return g


def wall_seg(length, h=3.2, thick=0.6, material='plaster'):
    """一段院墙 / 隔墙（沿 X 居中）：砖下碱、墙身、砖檐、两坡瓦帽与脊。"""
    g = Geo()
    a, b = -length / 2, length / 2
    g.add(box(length, thick + 0.06, 0.9, 'brick'))
    g.add(box(length, thick, h - 0.9, material, z=0.9))
    g.add(box(length, thick + 0.14, 0.12, 'brick_light', z=h - 0.12))
    for sy in (-1, 1):
        g.add(extrude_xz([(a - 0.1, 0), (b + 0.1, 0), (b + 0.1, 0.07), (a - 0.1, 0.07)], 0.5, 'tile', y=sy * (thick / 2 + 0.05)),
              t=(0, 0, h + 0.05))
    g.add(box(length + 0.1, 0.3, 0.32, 'ridge', z=h))
    g.add(box(length + 0.1, thick * 0.7, 0.14, 'tile', z=h))
    return g


def stone_balustrade(length, h=1.1, post_gap=1.8):
    """汉白玉栏杆（沿 X 居中）：地栿、栏板（透瓶、浮雕框）、望柱 + 柱头。"""
    g = Geo()
    n = max(1, round(length / post_gap))
    step = length / n
    g.add(box(length + 0.2, 0.36, 0.14, 'marble'))
    for i in range(n + 1):
        x = -length / 2 + i * step
        g.add(box(0.26, 0.26, h, 'marble', x=x, z=0.14))
        g.add(cyl(0.12, 0.3, 'marble', x=x, z=h + 0.14, seg=8, r_top=0.06))
    for i in range(n):
        x = -length / 2 + (i + 0.5) * step
        L = step - 0.3
        g.add(box(L, 0.18, h * 0.38, 'marble', x=x, z=0.14))
        g.add(box(L * 0.7, 0.2, h * 0.18, 'stone', x=x, z=0.14 + h * 0.1))
        for k in (-1, 0, 1):
            g.add(box(0.14, 0.16, h * 0.32, 'marble', x=x + k * L * 0.33, z=0.14 + h * 0.38))
        g.add(box(L, 0.16, 0.12, 'marble', x=x, z=0.14 + h * 0.7))
    return g


def stone_balustrade_ring(w, d, z, inset=0.3, gap_front=0.0):
    g = Geo()
    if gap_front > 0:
        seg = (w - gap_front) / 2
        for sx in (-1, 1):
            g.add(stone_balustrade(seg), t=(sx * (gap_front / 2 + seg / 2), -d / 2 + inset, z))
    else:
        g.add(stone_balustrade(w), t=(0, -d / 2 + inset, z))
    g.add(stone_balustrade(w), t=(0, d / 2 - inset, z))
    for sx in (-1, 1):
        g.add(stone_balustrade(d - 2 * inset), t=(sx * (w / 2 - inset), 0, z), rot=90)
    return g


def terrace(w, d, h, gap_front=6.0, steps=True):
    """月台：须弥座式石台（上下枋、束腰）+ 汉白玉栏杆 + 前出踏跺（两侧垂带）。"""
    g = Geo()
    g.add(box(w, d, h, 'stone'))
    g.add(box(w + 0.3, d + 0.3, 0.2, 'marble'))
    g.add(box(w + 0.3, d + 0.3, 0.2, 'marble', z=h - 0.2))
    g.add(box(w + 0.1, d + 0.1, 0.12, 'marble', z=h * 0.45))
    g.add(box(w - 0.2, d - 0.2, 0.04, 'brick_light', z=h))
    g.add(stone_balustrade_ring(w, d, h, gap_front=gap_front))
    if steps:
        sw = gap_front - 0.6
        run_ = h * 2.4
        g.add(kit.stair(sw, run_, h), t=(0, -d / 2 - run_ / 2, 0))
        for sx in (-1, 1):
            g.add(extrude_xz([(0, 0), (run_, 0), (0, h + 0.1)], 0.45, 'marble'), t=(sx * (sw / 2 + 0.22), -d / 2, 0), rot=90)
    return g


def paifang2(bays=3, w=12.0, h=7.0, stone=True, roofs=True):
    """牌坊 v2（沿 X，正面 -Y）：柱（夹杆石 + 抱鼓石）、大小额枋、花板、字牌；roofs=True 时每间顶上一座小庑殿顶
    （明间高起）并带斗栱；roofs=False（棂星门）时柱出头做冲天柱 + 云冠。"""
    g = Geo()
    mp = 'marble' if stone else 'vermilion'
    mb = 'marble' if stone else 'teal'
    xs = [-w / 2 + i * w / bays for i in range(bays + 1)]
    for i, x in enumerate(xs):
        ph = h + (1.6 if not roofs else 0)
        g.add(box(0.7, 0.7, ph, mp, x=x))
        g.add(box(1.2, 1.2, 1.5, 'stone', x=x))                                  # 夹杆石
        for sy in (-1, 1):                                                        # 抱鼓石
            g.add(box(0.36, 1.0, 0.5, 'stone', x=x, y=sy * 1.0))
            g.add(cyl(0.48, 0.3, 'stone', x=x - 0.15, y=sy * 1.0, z=0.5, seg=10))
        if not roofs:
            g.add(box(0.95, 0.95, 0.5, mb, x=x, z=ph))                            # 云冠
            g.add(cyl(0.35, 0.6, mb, x=x, z=ph + 0.5, seg=8, r_top=0.1))
    for i in range(bays):
        cx = (xs[i] + xs[i + 1]) / 2
        bw = xs[i + 1] - xs[i]
        mid = i == bays // 2
        zt = h - (0 if mid or bays == 1 else 0.9)
        g.add(box(bw, 0.5, 0.55, mb, x=cx, z=zt - 2.3))                          # 小额枋
        g.add(box(bw - 0.4, 0.3, 0.9, 'qing' if not stone else 'marble', x=cx, z=zt - 1.75))   # 花板 / 字牌
        if mid:
            g.add(box(bw * 0.45, 0.4, 0.8, 'gold', x=cx, z=zt - 1.7))
            g.add(box(bw * 0.38, 0.45, 0.6, 'qing', x=cx, z=zt - 1.6))
        g.add(box(bw + 0.3, 0.6, 0.6, mb, x=cx, z=zt - 0.85))                     # 大额枋
        if roofs:
            g.add(box(bw + 0.4, 0.8, 0.25, mb, x=cx, z=zt - 0.25))
            if not stone:
                g.add(dougong_row(bw, bw / 3, zt, 0, -1), t=(cx, 0, 0))
            g.add(roof_hip(bw + (1.4 if mid else 0.8), 2.4, kind='wudian', h=1.2 if mid else 1.0, overhang=0.6,
                           lift=0.45, push=0.3, beasts=1, rafters=False), t=(cx, 0, zt + (1.3 if not stone else 0)))
        else:
            for k in range(5):                                                   # 棂星门门扇棂条
                g.add(box(0.08, 0.1, zt - 2.6, mp, x=cx - bw * 0.3 + k * bw * 0.15, z=0.3))
    return g


def small_gate(w, d, h, aw, ah, bays=(4.0,), bays_y=(3.6,), col_h=3.8, roof_kind='xieshan', batter=0.07):
    """小城门（瓮城门 / 外城门）：城台 + 一座小城楼，正面朝 -Y。"""
    g = Geo()
    g.add(gate_platform2(w, d, h, aw, ah, batter=batter))
    g.add(hall2(bays, bays_y, col_h=col_h, front='door_center', back='windows', base_h=0.35, lanterns=False,
                roof_kind=roof_kind, beasts=2), t=(0, 0.3, h + 0.06))
    return g


def barbican_square(bw, bd, bh, gate_side='east', gate_w=7.0, wall_kw=None):
    """方形瓮城（主城门外 -Y）：后边在 y=0 接主城台。返回 (Geo, 瓮城门中心, 瓮城门朝向角)。"""
    g = Geo()
    kw = dict(height=bh, top_w=3.6, bottom_w=6.0)
    kw.update(wall_kw or {})
    cy = -bd / 2
    g.add(wall2(bw + kw['bottom_w'], **kw), t=(0, -bd, 0))                          # 前墙
    g.add(wall2(bd, **kw), t=(-bw / 2, cy, 0), rot=-90)                               # 西墙（外侧朝 -X）
    seg = (bd - gate_w) / 2
    for sy in (-1, 1):
        g.add(wall2(seg, **kw), t=(bw / 2, cy + sy * (gate_w / 2 + seg / 2), 0), rot=90)
    g.add(box(bw - kw['bottom_w'], bd - kw['bottom_w'] / 2, 0.08, 'stone', y=cy + kw['bottom_w'] / 4))
    return g, (bw / 2, cy), 90


# ---------------------------------------------------------------------------
# 石拱桥、树、船（v2）
# ---------------------------------------------------------------------------

def arch_bridge2(length=20.0, width=4.0, spans=1, rise=4.5, deck_arch=None):
    """石拱桥 v2（沿 X）：半椭圆拱、券石逐块错缝、拱顶吸水兽；桥面横铺条石；
    汉白玉栏杆随坡（望柱莲头、寻杖、净瓶、栏板）；两端抱鼓石；多孔时桥墩做分水尖。"""
    g = Geo()
    L = length
    span_total = L * 0.7
    sw = span_total / spans
    pier = sw * 0.16
    hw = (sw - pier) / 2
    crown = rise + 1.0
    camber = deck_arch if deck_arch is not None else 0.5
    z_end = 0.5
    n_top = 32

    def deck_z(x):
        t = abs(x) / (L / 2)
        flat = span_total / L
        if t <= flat:
            return crown + camber * math.cos(math.pi / 2 * t / flat)
        k = (t - flat) / (1 - flat)
        return z_end + (crown - z_end) * (1 - k) ** 1.4

    top = [(-L / 2 + L * i / n_top, deck_z(-L / 2 + L * i / n_top)) for i in range(n_top + 1)]
    bottom = [(L / 2, 0.0)]
    seg = 16
    for k in reversed(range(spans)):
        cx = -span_total / 2 + (k + 0.5) * sw
        for sidx in range(seg + 1):
            a = math.pi * sidx / seg
            bottom.append((cx + hw * math.cos(a), rise * math.sin(a)))
    bottom.append((-L / 2, 0.0))
    g.add(extrude_xz(top + bottom, width, 'stone'))
    # 券石：逐块，长短交替微凸；拱顶吸水兽
    for k in range(spans):
        cx = -span_total / 2 + (k + 0.5) * sw
        nv = 21
        for sy in (-1, 1):
            for sidx in range(nv):
                a0, a1 = math.pi * (sidx + 0.04) / nv, math.pi * (sidx + 0.96) / nv
                d = 0.62 if sidx % 2 else 0.48
                q = [(cx + hw * math.cos(a0), rise * math.sin(a0)), (cx + hw * math.cos(a1), rise * math.sin(a1)),
                     (cx + (hw + d) * math.cos(a1), (rise + d) * math.sin(a1)), (cx + (hw + d) * math.cos(a0), (rise + d) * math.sin(a0))]
                g.add(extrude_xz(q, 0.14, 'marble', y=sy * (width / 2 + 0.04)))
            g.add(box(0.5, 0.5, 0.55, 'marble', x=cx, y=sy * (width / 2 + 0.2), z=rise + 0.15))
            g.add(box(0.32, 0.3, 0.2, 'stone', x=cx, y=sy * (width / 2 + 0.5), z=rise + 0.32))
        g.add(extrude_xz([(cx - hw, 0), (cx + hw, 0), (cx + hw, 0.06), (cx - hw, 0.06)], width - 0.1, 'stone'))
    for k in range(spans - 1):                                                      # 分水尖
        px = -span_total / 2 + (k + 1) * sw
        for sy in (-1, 1):
            g.add(prism([(px - pier / 2, sy * width / 2, 0), (px + pier / 2, sy * width / 2, 0), (px, sy * (width / 2 + 1.4), 0)],
                        [(px - pier / 2, sy * width / 2, rise * 0.55), (px + pier / 2, sy * width / 2, rise * 0.55),
                         (px, sy * (width / 2 + 0.2), rise * 0.55)], 'stone'))
    # 桥面条石
    for i in range(n_top):
        (x0, z0), (x1, z1) = top[i], top[i + 1]
        for f in (0.0, 0.5):
            x = x0 + (x1 - x0) * f
            z = z0 + (z1 - z0) * f
            g.add(box(0.06, width - 0.9, 0.04, 'marble', x=x, z=z))
    # 栏杆
    post_every = 2
    for sy in (-1, 1):
        y = sy * (width / 2 - 0.15)
        for i in range(n_top):
            (x0, z0), (x1, z1) = top[i], top[i + 1]
            g.add(extrude_xz([(x0, z0), (x1, z1), (x1, z1 + 0.14), (x0, z0 + 0.14)], 0.34, 'marble', y=y))        # 地栿
            g.add(extrude_xz([(x0, z0 + 0.14), (x1, z1 + 0.14), (x1, z1 + 0.5), (x0, z0 + 0.5)], 0.16, 'marble', y=y))  # 栏板
            g.add(extrude_xz([(x0, z0 + 0.82), (x1, z1 + 0.82), (x1, z1 + 0.94), (x0, z0 + 0.94)], 0.16, 'marble', y=y))  # 寻杖
            xm, zm = (x0 + x1) / 2, (z0 + z1) / 2
            g.add(box(0.14, 0.14, 0.32, 'marble', x=xm, y=y, z=zm + 0.5))                                         # 净瓶
        for i in range(0, n_top + 1, post_every):
            x, z = top[i]
            g.add(box(0.26, 0.26, 1.12, 'marble', x=x, y=y, z=z))
            g.add(cyl(0.15, 0.26, 'marble', x=x, y=y, z=z + 1.12, seg=8, r_top=0.07))
        for x, z in (top[0], top[-1]):                                               # 抱鼓石
            sx = -1 if x < 0 else 1
            g.add(box(0.9, 0.3, 0.45, 'marble', x=x + sx * 0.45, y=y, z=z))
            g.add(cyl(0.38, 0.28, 'marble', x=x + sx * 0.5, y=y, z=z + 0.45, seg=10))
    return g


def blob(r, material, c, jitter=0.15, seed=0, squash=(1, 1, 1)):
    """细分一次的二十面体（80 面）树冠团。"""
    t = (1 + 5 ** 0.5) / 2
    v = [Vector(p).normalized() for p in [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t),
                                          (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]]
    f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
         (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    mid = {}

    def m(a, b):
        key = (min(a, b), max(a, b))
        if key not in mid:
            v.append(((v[a] + v[b]) / 2).normalized())
            mid[key] = len(v) - 1
        return mid[key]

    f2 = []
    for a, b, cc in f:
        ab, bc, ca = m(a, b), m(b, cc), m(cc, a)
        f2 += [(a, ab, ca), (b, bc, ab), (cc, ca, bc), (ab, bc, ca)]
    rng = random.Random(seed)
    pts = [Vector((c[0] + p.x * r * squash[0] * (1 + rng.uniform(-jitter, jitter)),
                   c[1] + p.y * r * squash[1] * (1 + rng.uniform(-jitter, jitter)),
                   c[2] + p.z * r * squash[2] * (1 + rng.uniform(-jitter, jitter)))) for p in v]
    g = Geo()
    for a, b, cc in f2:
        g.face([tuple(pts[a]), tuple(pts[b]), tuple(pts[cc])], material)
    return g


def _rot_dir(d, rng, spread, up_bias=0.3):
    axis = d.orthogonal().normalized()
    from mathutils import Matrix
    axis = Matrix.Rotation(rng.uniform(0, 2 * math.pi), 3, d) @ axis
    nd = Matrix.Rotation(rng.uniform(spread * 0.6, spread), 3, axis) @ d
    nd.z += up_bias
    return nd.normalized()


def _branches(g, p, d, length, r, depth, rng, tips, spread=0.75, up_bias=0.25, kids=(2, 3), shrink=0.72):
    bend = _rot_dir(d, rng, 0.25, 0)
    mid = p + d * length * 0.5
    end = mid + bend * length * 0.5
    g.add(beam(tuple(p), tuple(mid), r, r * 0.85, 'trunk', seg=6))
    g.add(beam(tuple(mid), tuple(end), r * 0.85, r * 0.68, 'trunk', seg=6))
    if depth == 0:
        tips.append((end, bend))
        return
    for _ in range(rng.randint(*kids)):
        nd = _rot_dir(bend, rng, spread, up_bias)
        _branches(g, end, nd, length * shrink, r * 0.62, depth - 1, rng, tips, spread, up_bias, kids, shrink)


def tree2(kind='broadleaf', height=10.0, seed=0):
    """树 v2：递归分枝的树干（两段微弯），枝端挂细分树冠团。'broadleaf' 阔叶、'pine' 松、'willow' 柳、'ginkgo' 银杏。"""
    rng = random.Random(seed)
    g = Geo()
    H = height
    tips = []
    if kind == 'broadleaf':
        trunk_h = H * 0.38
        _branches(g, Vector((0, 0, 0)), Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 1)).normalized(), trunk_h,
                  H * 0.045, 0, rng, tips)
        base, d = tips.pop()
        _branches_root = []
        for k in range(3):
            nd = Vector((math.cos(k * 2.1 + rng.uniform(-0.3, 0.3)), math.sin(k * 2.1 + rng.uniform(-0.3, 0.3)), 1.1)).normalized()
            _branches(g, base, nd, H * 0.22, H * 0.026, 2, rng, tips, spread=0.7, up_bias=0.2)
        for i, (p, d) in enumerate(tips):
            g.add(blob(H * rng.uniform(0.085, 0.12), 'leaf', tuple(p + Vector((0, 0, H * 0.03))), 0.2, seed * 31 + i, (1.15, 1.15, 0.85)))
        g.add(blob(H * 0.17, 'leaf', tuple(base + Vector((0, 0, H * 0.26))), 0.18, seed, (1.2, 1.2, 0.8)))
    elif kind == 'ginkgo':
        trunk_h = H * 0.3
        _branches(g, Vector((0, 0, 0)), Vector((0, 0, 1)), trunk_h, H * 0.04, 0, rng, tips)
        base, _ = tips.pop()
        for k in range(4):
            z = H * (0.3 + 0.13 * k)
            for j in range(3):
                a = j * 2.1 + k * 0.9
                p0 = Vector((0, 0, z))
                p1 = p0 + Vector((math.cos(a), math.sin(a), 0.9)).normalized() * H * (0.22 - 0.04 * k)
                g.add(beam(tuple(p0), tuple(p1), H * 0.016, H * 0.008, 'trunk', seg=5))
                g.add(blob(H * (0.1 - 0.012 * k), 'ginkgo', tuple(p1), 0.2, seed * 17 + k * 3 + j, (1, 1, 0.9)))
        g.add(beam((0, 0, trunk_h), (0, 0, H * 0.85), H * 0.03, H * 0.012, 'trunk', seg=6))
        g.add(blob(H * 0.1, 'ginkgo', (0, 0, H * 0.88), 0.15, seed, (1, 1, 1.1)))
    elif kind == 'pine':
        pts = [Vector((0, 0, 0))]
        for k in range(4):                                                           # 扭曲的主干
            a = rng.uniform(0, 2 * math.pi)
            pts.append(pts[-1] + Vector((math.cos(a) * H * 0.04, math.sin(a) * H * 0.04, H * 0.19)))
        for k in range(4):
            g.add(beam(tuple(pts[k]), tuple(pts[k + 1]), H * (0.04 - 0.007 * k), H * (0.033 - 0.007 * k), 'trunk', seg=7))
        for i in range(7):
            f = 0.35 + 0.65 * i / 6
            k = min(3, int(f * 4))
            p0 = pts[k].lerp(pts[k + 1], f * 4 - k)
            a = i * 2.4 + rng.uniform(-0.3, 0.3)
            reach = H * (0.32 - 0.03 * i)
            d = Vector((math.cos(a), math.sin(a), 0.15)).normalized()
            p1 = p0 + d * reach * 0.6
            p2 = p1 + Vector((d.x, d.y, -0.05)).normalized() * reach * 0.4
            g.add(beam(tuple(p0), tuple(p1), H * 0.016, H * 0.011, 'trunk', seg=5))
            g.add(beam(tuple(p1), tuple(p2), H * 0.011, H * 0.006, 'trunk', seg=5))
            for j, (pp, rr) in enumerate(((p1, 0.09), (p2, 0.11), ((p1 + p2) / 2 + Vector((0, 0, H * 0.02)), 0.08))):
                g.add(blob(H * (rr - 0.005 * i), 'pine', tuple(pp + Vector((0, 0, H * 0.035))), 0.15, seed * 13 + i * 3 + j, (1.5, 1.5, 0.42)))
        g.add(blob(H * 0.1, 'pine', tuple(pts[-1] + Vector((0, 0, H * 0.04))), 0.1, seed, (1.5, 1.5, 0.5)))
    elif kind == 'willow':
        _branches(g, Vector((0, 0, 0)), Vector((0.08, 0, 1)).normalized(), H * 0.34, H * 0.05, 0, rng, tips)
        base, _ = tips.pop()
        for k in range(5):
            a = k * 2 * math.pi / 5 + rng.uniform(-0.3, 0.3)
            nd = Vector((math.cos(a), math.sin(a), 1.0)).normalized()
            _branches(g, base, nd, H * 0.2, H * 0.024, 1, rng, tips, spread=0.5, up_bias=0.1, kids=(2, 2))
        for i, (p, d) in enumerate(tips):
            g.add(blob(H * 0.035, 'willow', tuple(p), 0.15, seed * 7 + i, (1.2, 1.2, 0.8)))
            for k in range(11):                                                       # 下垂柳条：三段渐细弯垂
                b = rng.uniform(0, 2 * math.pi)
                rr = H * rng.uniform(0.01, 0.07)
                ln = H * rng.uniform(0.3, 0.5) * min(1.0, p.z / (H * 0.7))
                q0 = p + Vector((math.cos(b) * rr, math.sin(b) * rr, 0))
                out = Vector((math.cos(b), math.sin(b), 0)) * H * 0.04
                q1 = q0 + out + Vector((0, 0, -ln * 0.3))
                q2 = q1 + out * 0.4 + Vector((0, 0, -ln * 0.35))
                q3 = q2 + out * 0.1 + Vector((0, 0, -ln * 0.35))
                r0 = H * 0.006
                g.add(beam(tuple(q0), tuple(q1), r0 * 1.6, r0 * 1.3, 'willow', seg=3))
                g.add(beam(tuple(q1), tuple(q2), r0 * 1.3, r0 * 0.9, 'willow', seg=3))
                g.add(beam(tuple(q2), tuple(q3), r0 * 0.9, r0 * 0.3, 'willow', seg=3))
    else:
        raise ValueError(f'未知树种 {kind}')
    return g


def boat2(length=10.0, covered=False, width=None):
    """木船 v2（沿 X）：9 个横剖面放样的船壳，两头上翘；舷侧外板线、护舷木、船内肋骨与横梁、舱底铺板、
    船尾舵与橹；covered=True 时中部竹篷（篷骨 + 篷面）与篷内暗面。"""
    g = Geo()
    W = width or length * 0.26
    depth = W * 0.4
    ts = [-1.0, -0.82, -0.6, -0.3, 0.0, 0.3, 0.6, 0.82, 1.0]
    secs = []
    for t in ts:
        hw = W / 2 * max(0.06, 1 - 0.85 * t ** 2)
        sheer = depth + depth * 0.7 * t * t
        bot = depth * 0.5 * t ** 4
        x = t * length / 2
        secs.append([(x, -hw, sheer), (x, -hw * 0.92, sheer * 0.55 + bot * 0.45), (x, -hw * 0.6, bot + depth * 0.1), (x, 0, bot),
                     (x, hw * 0.6, bot + depth * 0.1), (x, hw * 0.92, sheer * 0.55 + bot * 0.45), (x, hw, sheer)])
    nsec = len(secs[0])
    for a, b in zip(secs[:-1], secs[1:]):
        for i in range(nsec - 1):
            g.face([a[i], b[i], b[i + 1], a[i + 1]], 'wood')
            ia = [(q[0], q[1] * 0.93, q[2] + 0.06) for q in (a[i], a[i + 1])]
            ib = [(q[0], q[1] * 0.93, q[2] + 0.06) for q in (b[i], b[i + 1])]
            g.face([ia[1], ib[1], ib[0], ia[0]], 'trunk')                                # 船内壁（内缩一层，避免与外壳反向重合）
    for sec in (secs[0], secs[-1]):
        g.face(sec, 'wood')
    # 护舷木与外板线
    for side in (0, nsec - 1):
        for a, b in zip(secs[:-1], secs[1:]):
            g.add(bar(a[side], b[side], 0.14, 0.16, 'trunk'))
        for k in (1, 2):
            for a, b in zip(secs[:-1], secs[1:]):
                pa = _v(a[side]).lerp(_v(a[1 if side == 0 else nsec - 2]), 0.5 * k)
                pb = _v(b[side]).lerp(_v(b[1 if side == 0 else nsec - 2]), 0.5 * k)
                g.add(bar(tuple(pa), tuple(pb), 0.05, 0.05, 'trunk'))
    # 舱底板、肋骨与横梁
    g.add(box(length * 0.62, W * 0.5, 0.06, 'wood', z=depth * 0.12))
    for i in range(1, len(ts) - 1):
        sec = secs[i]
        for a, b in zip(sec[:-1], sec[1:]):
            pa, pb = _v(a), _v(b)
            g.add(bar(tuple(pa + Vector((0, 0, 0.02))), tuple(pb + Vector((0, 0, 0.02))), 0.08, 0.08, 'trunk'))
        if i in (2, 4, 6):
            g.add(box(0.3, 2 * abs(sec[0][1]) * 0.96, 0.12, 'trunk', x=sec[0][0], z=sec[0][2] - 0.25))
    # 船尾舵与橹
    sx = -length / 2
    g.add(box(0.12, 0.7, 1.4, 'trunk', x=sx - 0.2, z=-0.2))
    g.add(beam((sx + 0.6, 0.2, depth * 1.8), (sx - length * 0.35, 0.6, -0.1), 0.06, 0.05, 'trunk', seg=5))
    g.add(box(1.1, 0.06, 0.3, 'trunk', x=sx - length * 0.33, y=0.6, z=-0.05))
    if covered:
        n = 8
        r = W * 0.48
        ln = length * 0.4
        arc = [(-r * math.cos(math.pi * k / n), depth * 0.95 + r * math.sin(math.pi * k / n)) for k in range(n + 1)]
        for k in range(n):
            (y0, z0), (y1, z1) = arc[k], arc[k + 1]
            g.face([(-ln / 2, y0, z0), (ln / 2, y0, z0), (ln / 2, y1, z1), (-ln / 2, y1, z1)], 'earth')
            g.face([(-ln / 2, y1, z1 - 0.05), (ln / 2, y1, z1 - 0.05), (ln / 2, y0, z0 - 0.05), (-ln / 2, y0, z0 - 0.05)], 'void')
            for x in [-ln / 2 + j * ln / 5 for j in range(6)]:                       # 篷骨
                g.add(bar((x, y0 * 1.03, z0 + 0.03), (x, y1 * 1.03, z1 + 0.03), 0.07, 0.06, 'trunk'))
    else:
        g.add(beam((length * 0.1, 0.4, depth * 1.4), (-length * 0.3, W * 0.42, depth * 1.2), 0.05, 0.05, 'trunk', seg=5))
        g.add(box(0.9, 0.05, 0.22, 'trunk', x=-length * 0.33, y=W * 0.43, z=depth * 1.18))
    return g


# ---------------------------------------------------------------------------
# 道具
# ---------------------------------------------------------------------------

def lantern(drop=1.0):
    """挂灯笼：吊绳 + 灯身 + 上下金色口。原点在吊点。"""
    g = Geo()
    g.add(beam((0, 0, 0), (0, 0, -drop), 0.02, 0.02, 'ink', seg=4))
    g.add(cyl(0.12, 0.1, 'gold', z=-drop - 0.1, seg=8))
    g.add(cyl(0.3, 0.32, 'vermilion', z=-drop - 0.42, seg=10, r_top=0.36))
    g.add(cyl(0.36, 0.32, 'vermilion', z=-drop - 0.74, seg=10, r_top=0.3))
    g.add(cyl(0.14, 0.1, 'gold', z=-drop - 0.84, seg=8))
    g.add(beam((0, 0, -drop - 0.84), (0, 0, -drop - 1.2), 0.04, 0.01, 'gold', seg=4))
    return g


def banner(pole_h=6.0, flag_w=1.4, flag_h=2.2, color='vermilion'):
    """旗杆 + 牙旗（三角飘带边），原点在杆脚。"""
    g = Geo()
    g.add(box(0.5, 0.5, 0.35, 'stone'))
    g.add(cyl(0.06, pole_h, 'wood', seg=6))
    g.add(cyl(0.1, 0.25, 'gold', z=pole_h, seg=6, r_top=0.0))
    z0 = pole_h - 0.3 - flag_h
    g.add(box(flag_w, 0.04, flag_h, color, x=flag_w / 2 + 0.06, z=z0))
    g.add(box(flag_w + 0.1, 0.05, 0.12, 'gold', x=flag_w / 2 + 0.06, z=z0 + flag_h))
    for i in range(4):                                                                 # 火焰边
        x = 0.25 + i * flag_w / 4
        g.add(extrude_xz([(x, z0), (x + flag_w / 8, z0 - 0.35), (x + flag_w / 4, z0)], 0.04, 'gold'))
    return g


def human_ref():
    """1.7 米人形，仅用于对比渲染，不进成品。"""
    g = Geo()
    g.add(cyl(0.22, 1.45, 'vermilion', seg=10))
    g.add(cyl(0.13, 0.25, 'vermilion', z=1.45, seg=10, r_top=0.08))
    return g
