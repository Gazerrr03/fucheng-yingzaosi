"""生成一个测试用 glb，用来验证加载器和归一化：
- 单位是厘米（整体放大 100 倍）、原点偏移、绕 Y 轴转了 90°（模拟图生 3D 的乱尺度和乱朝向）
- 两个材质：城台用内嵌 PNG 贴图（砖纹），屋顶用纯色
- 节点层级：root（TRS）→ base、roof

用法：python3 tools/make_test_glb.py out.glb
"""
import io
import json
import math
import struct
import sys

from PIL import Image, ImageDraw


def brick_png() -> bytes:
    im = Image.new("RGB", (128, 128), (176, 150, 112))
    d = ImageDraw.Draw(im)
    for row in range(8):
        y = row * 16
        d.line([(0, y), (128, y)], fill=(120, 98, 70), width=2)
        off = 0 if row % 2 else 16
        for x in range(off, 128, 32):
            d.line([(x, y), (x, y + 16)], fill=(120, 98, 70), width=2)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def box(w, h, d, y0):
    """带 UV 和逐面法线的长方体（城台）。"""
    x, z = w / 2, d / 2
    faces = [
        ((0, 0, 1), [(-x, y0, z), (x, y0, z), (x, y0 + h, z), (-x, y0 + h, z)]),
        ((0, 0, -1), [(x, y0, -z), (-x, y0, -z), (-x, y0 + h, -z), (x, y0 + h, -z)]),
        ((1, 0, 0), [(x, y0, z), (x, y0, -z), (x, y0 + h, -z), (x, y0 + h, z)]),
        ((-1, 0, 0), [(-x, y0, -z), (-x, y0, z), (-x, y0 + h, z), (-x, y0 + h, -z)]),
        ((0, 1, 0), [(-x, y0 + h, z), (x, y0 + h, z), (x, y0 + h, -z), (-x, y0 + h, -z)]),
    ]
    pos, nor, uv, idx = [], [], [], []
    for n, quad in faces:
        b = len(pos)
        pos += quad
        nor += [n] * 4
        uv += [(0, 2), (3, 2), (3, 0), (0, 0)]
        idx += [b, b + 1, b + 2, b, b + 2, b + 3]
    return pos, nor, uv, idx


def roof(w, d, y0, h):
    """四坡屋顶（逐面法线）。"""
    x, z = w / 2, d / 2
    apex_l, apex_r = (-x * 0.35, y0 + h, 0), (x * 0.35, y0 + h, 0)
    tris = [
        [(-x, y0, z), (x, y0, z), apex_r], [(-x, y0, z), apex_r, apex_l],
        [(x, y0, -z), (-x, y0, -z), apex_l], [(x, y0, -z), apex_l, apex_r],
        [(x, y0, z), (x, y0, -z), apex_r], [(-x, y0, -z), (-x, y0, z), apex_l],
    ]
    pos, nor, idx = [], [], []
    for t in tris:
        a, b, c = t
        u = [b[i] - a[i] for i in range(3)]
        v = [c[i] - a[i] for i in range(3)]
        n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        l = math.sqrt(sum(k * k for k in n))
        n = [k / l for k in n]
        base = len(pos)
        pos += t
        nor += [n] * 3
        idx += [base, base + 1, base + 2]
    return pos, nor, idx


def main(out: str) -> None:
    bp, bn, buv, bi = box(1.0, 0.45, 0.6, 0.0)
    rp, rn, ri = roof(0.8, 0.5, 0.45, 0.35)

    blob = bytearray()
    views, accessors = [], []

    def add(data: bytes, target=None):
        while len(blob) % 4:
            blob.append(0)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), **({"target": target} if target else {})})
        blob.extend(data)
        return len(views) - 1

    def acc(values, comp, typ, target, minmax=False):
        flat = [c for v in values for c in (v if isinstance(v, (tuple, list)) else (v,))]
        fmt = {"f": 5126, "H": 5123}[comp]
        view = add(struct.pack(f"<{len(flat)}{comp}", *flat), target)
        a = {"bufferView": view, "componentType": fmt, "count": len(values), "type": typ}
        if minmax:
            a["min"] = [min(v[i] for v in values) for i in range(3)]
            a["max"] = [max(v[i] for v in values) for i in range(3)]
        accessors.append(a)
        return len(accessors) - 1

    A, E = 34962, 34963
    base_prim = {
        "attributes": {"POSITION": acc(bp, "f", "VEC3", A, True), "NORMAL": acc(bn, "f", "VEC3", A), "TEXCOORD_0": acc(buv, "f", "VEC2", A)},
        "indices": acc(bi, "H", "SCALAR", E), "material": 0,
    }
    roof_prim = {
        "attributes": {"POSITION": acc(rp, "f", "VEC3", A, True), "NORMAL": acc(rn, "f", "VEC3", A)},
        "indices": acc(ri, "H", "SCALAR", E), "material": 1,
    }
    img_view = add(brick_png())

    s = math.sin(math.radians(45)); c = math.cos(math.radians(45))  # 绕 Y 90°
    gltf = {
        "asset": {"version": "2.0", "generator": "make_test_glb.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [
            {"name": "root", "translation": [500, 300, -200], "rotation": [0, s, 0, c], "scale": [100, 100, 100], "children": [1, 2]},
            {"name": "base", "mesh": 0},
            {"name": "roof", "mesh": 1},
        ],
        "meshes": [{"primitives": [base_prim]}, {"primitives": [roof_prim]}],
        "materials": [
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0}},
            {"pbrMetallicRoughness": {"baseColorFactor": [0.32, 0.36, 0.42, 1], "metallicFactor": 0}},
        ],
        "textures": [{"source": 0}],
        "images": [{"bufferView": img_view, "mimeType": "image/png"}],
        "buffers": [{"byteLength": 0}],
        "bufferViews": views,
        "accessors": accessors,
    }
    while len(blob) % 4:
        blob.append(0)
    gltf["buffers"][0]["byteLength"] = len(blob)
    js = json.dumps(gltf).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(out, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    print(f"wrote {out} ({total} bytes)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "test.glb")
