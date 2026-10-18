"""把 assets/raw 里当前推荐的生图（selected.json）导出成运行时资源。

输出到 public/assets/，并写一份 manifest.json 记录尺寸，供运行时读取。
原件不改动；重复运行会覆盖输出。
"""
import json
import pathlib
import re
import struct
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "assets" / "raw"
OUT = ROOT / "public" / "assets"

MAP_KEYS = {
    "map_xiangyang": "xiangyang",
    "map_jingzhou": "jingzhou",
    "map_baoding": "baoding",
    "map_overview": "overview",
}


def rule_for(key: str):
    """返回 (子目录, 输出名, 最长边) ；最长边为 None 表示保持原尺寸。"""
    if key in MAP_KEYS:
        return "maps", MAP_KEYS[key], None
    if key.startswith("cloud_"):
        return "clouds", key, 1024
    if key.startswith("icon_gene"):
        return "ui", key, 256
    if key.startswith("icon_marker"):
        return "ui", key, 128
    if key.startswith("seal_"):
        return "ui", key, 256
    if key == "ui_panel_paper":
        return "ui", key, None
    if key.startswith(("K", "X", "J", "B")) and ("_main" in key or "_side" in key):
        return "concepts", key, 512
    return None


def cutout_white(im: Image.Image) -> Image.Image:
    """概念图是白底：把与边框连通的近白色区域变透明，再裁到物体包围盒（底边即物体落地处）。"""
    rgb = np.asarray(im.convert("RGB")).astype(np.int16)
    lo, hi = rgb.min(axis=2), rgb.max(axis=2)
    cand = (lo > 228) & (hi - lo < 22)
    labels, _ = ndimage.label(cand)
    edge_ids = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    bg = np.isin(labels, edge_ids[edge_ids > 0])
    h, w = bg.shape
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    box = alpha.point(lambda a: 255 if a > 24 else 0).getbbox()
    if box:
        pad = int(0.02 * max(w, h))
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + 1))
        out = out.crop(box)
    return out


GLB_MAGIC, CHUNK_JSON, CHUNK_BIN = 0x46546C67, 0x4E4F534A, 0x004E4942
NP_TYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path: pathlib.Path):
    data = path.read_bytes()
    magic, _, _ = struct.unpack_from("<III", data, 0)
    assert magic == GLB_MAGIC, f"{path} 不是 glb"
    gltf, binary, off = None, b"", 12
    while off < len(data):
        length, kind = struct.unpack_from("<II", data, off)
        chunk = data[off + 8 : off + 8 + length]
        if kind == CHUNK_JSON:
            gltf = json.loads(chunk)
        elif kind == CHUNK_BIN:
            binary = chunk
        off += 8 + length
    return gltf, binary


def read_accessor(gltf: dict, binary: bytes, index: int) -> np.ndarray:
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    dtype = np.dtype(NP_TYPES[acc["componentType"]])
    n = NCOMP[acc["type"]]
    stride = view.get("byteStride") or dtype.itemsize * n
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    raw = np.frombuffer(binary, np.uint8, acc["count"] * stride, start).reshape(acc["count"], stride)
    return raw[:, : dtype.itemsize * n].copy().view(dtype).reshape(acc["count"], n)


def node_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = r * np.array(node.get("scale", [1, 1, 1]))
    m[:3, 3] = node.get("translation", [0, 0, 0])
    return m


def quantize_glb(src: pathlib.Path, dst: pathlib.Path) -> list:
    """位置量化成 int16、法线量化成 int8（KHR_mesh_quantization），索引原样保留。
    每个网格一套反量化变换（统一缩放 + 平移），放在挂网格的节点上，法线方向不受影响。
    返回节点变换后的总包围盒 [[min], [max]]（与运行时加载器的算法一致，用原始浮点坐标）。"""
    gltf, binary = read_glb(src)
    out = bytearray()
    views, accessors = [], []

    def add(arr: np.ndarray, target, stride=None) -> int:
        while len(out) % 4:
            out.append(0)
        view = {"buffer": 0, "byteOffset": len(out), "byteLength": arr.nbytes}
        if target:
            view["target"] = target
        if stride:
            view["byteStride"] = stride
        out.extend(arr.tobytes())
        views.append(view)
        return len(views) - 1

    def accessor(view: int, ctype: int, count: int, kind: str, normalized=False, lo=None, hi=None) -> int:
        acc = {"bufferView": view, "componentType": ctype, "count": count, "type": kind}
        if normalized:
            acc["normalized"] = True
        if lo is not None:
            acc["min"], acc["max"] = lo, hi
        accessors.append(acc)
        return len(accessors) - 1

    # 网格 → 反量化（中心、半边长）
    decode = {}
    for mi, mesh in enumerate(gltf["meshes"]):
        pos = np.concatenate([read_accessor(gltf, binary, p["attributes"]["POSITION"]) for p in mesh["primitives"]]).astype(np.float64)
        lo, hi = pos.min(0), pos.max(0)
        decode[mi] = ((lo + hi) / 2, float(max((hi - lo).max() / 2, 1e-6)))
        for prim in mesh["primitives"]:
            attrs = prim["attributes"]
            center, half = decode[mi]
            p = read_accessor(gltf, binary, attrs["POSITION"]).astype(np.float64)
            q = np.zeros((len(p), 4), np.int16)
            q[:, :3] = np.clip(np.round((p - center) / half * 32767), -32767, 32767)
            new = {"POSITION": accessor(add(q, 34962, 8), 5122, len(p), "VEC3", True, q[:, :3].min(0).tolist(), q[:, :3].max(0).tolist())}
            if "NORMAL" in attrs:
                n = read_accessor(gltf, binary, attrs["NORMAL"]).astype(np.float64)
                qn = np.zeros((len(n), 4), np.int8)
                qn[:, :3] = np.clip(np.round(n * 127), -127, 127)
                new["NORMAL"] = accessor(add(qn, 34962, 4), 5120, len(n), "VEC3", True)
            for k, v in attrs.items():
                if k not in new:
                    a = gltf["accessors"][v]
                    new[k] = accessor(add(read_accessor(gltf, binary, v), 34962), a["componentType"], a["count"], a["type"], a.get("normalized", False))
            prim["attributes"] = new
            if "indices" in prim:
                a = gltf["accessors"][prim["indices"]]
                prim["indices"] = accessor(add(read_accessor(gltf, binary, prim["indices"]).ravel(), 34963), a["componentType"], a["count"], "SCALAR")

    # 包围盒：与 src/render/gltf.ts 一样，按图元原始 min/max 的 8 个角经节点变换后取总范围
    src_gltf, _ = read_glb(src)
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)

    def visit(i: int, parent: np.ndarray):
        nonlocal lo, hi
        node = src_gltf["nodes"][i]
        world = parent @ node_matrix(node)
        if "mesh" in node:
            for prim in src_gltf["meshes"][node["mesh"]]["primitives"]:
                acc = src_gltf["accessors"][prim["attributes"]["POSITION"]]
                for c in range(8):
                    corner = [acc["max"][k] if c >> k & 1 else acc["min"][k] for k in range(3)]
                    w = world @ np.array([*corner, 1.0])
                    lo, hi = np.minimum(lo, w[:3]), np.maximum(hi, w[:3])
        for child in node.get("children", []):
            visit(child, world)

    scene = src_gltf.get("scenes", [{}])[src_gltf.get("scene", 0)]
    for r in scene.get("nodes", range(len(src_gltf["nodes"]))):
        visit(r, np.eye(4))

    # 反量化变换挂到节点上；节点原本有变换时，网格挪到新建的子节点里
    for node in list(gltf["nodes"]):
        if "mesh" not in node:
            continue
        center, half = decode[node["mesh"]]
        dq = {"translation": center.tolist(), "scale": [half] * 3}
        if any(k in node for k in ("matrix", "translation", "rotation", "scale")):
            gltf["nodes"].append({"mesh": node.pop("mesh"), **dq})
            node.setdefault("children", []).append(len(gltf["nodes"]) - 1)
        else:
            node.update(dq)

    gltf["bufferViews"], gltf["accessors"] = views, accessors
    gltf["buffers"] = [{"byteLength": len(out)}]
    for key in ("extensionsUsed", "extensionsRequired"):
        gltf[key] = sorted(set(gltf.get(key, [])) | {"KHR_mesh_quantization"})
    while len(out) % 4:
        out.append(0)
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    dst.write_bytes(struct.pack("<III", GLB_MAGIC, 2, total) + struct.pack("<II", len(js), CHUNK_JSON) + js + struct.pack("<II", len(out), CHUNK_BIN) + bytes(out))
    return [[round(float(v), 4) for v in lo], [round(float(v), 4) for v in hi]]


def write_model_bounds(bounds: dict) -> None:
    """data/models.json：有远景简模的资产记下精模包围盒（bounds），远景简模先到时按它摆放。"""
    path = ROOT / "data" / "models.json"
    spec = json.loads(path.read_text())
    for key, item in spec.items():
        if isinstance(item, dict) and item.get("far") and key in bounds:
            item["bounds"] = bounds[key]
    text = json.dumps(spec, ensure_ascii=False, indent=2)
    # 纯数字的短数组收成一行（与 vite.config.ts 的 formatJSON 一致）
    text = re.sub(r"\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]", lambda m: "[" + ", ".join(re.split(r",\s*", m.group(1))) + "]", text)
    text = re.sub(r"\[\s*(\[[^\[\]]*\]),\s*(\[[^\[\]]*\])\s*\]", r"[\1, \2]", text)
    path.write_text(text + "\n")


def main() -> None:
    selected = json.loads((RAW / "_management" / "selected.json").read_text())
    models_only = "--models-only" in sys.argv
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if models_only and manifest_path.exists() else {}
    for item in [] if models_only else selected:
        key = item["key"]
        rule = rule_for(key)
        if rule is None:
            continue
        sub, name, max_edge = rule
        src = ROOT / item["path"]
        # 底图：如果 assets/raw/maps/upscaled/{城}.png 存在（超分后的版本），优先用它；最长边限制 4096
        if sub == "maps":
            up = RAW / "maps" / "upscaled" / f"{name}.png"
            if up.exists():
                src = up
                max_edge = 4096
        im = Image.open(src)
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        if sub == "concepts":
            im = cutout_white(im)
        if max_edge and max(im.size) > max_edge:
            im.thumbnail((max_edge, max_edge), Image.LANCZOS)
        dst = OUT / sub / f"{name}.webp"
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, "WEBP", quality=90, method=6)
        manifest[f"{sub}/{name}"] = {"file": f"assets/{sub}/{name}.webp", "size": list(im.size)}
        print(f"{key:28s} -> {dst.relative_to(ROOT)} {im.size}")
    # 3D 模型：assets/models/{ID}.glb 量化后写到运行时目录（归一化在运行时做），
    # 并把精模的包围盒写进 data/models.json，供只加载了远景简模时按精模尺寸摆放
    models = []
    bounds = {}
    src_dir = ROOT / "assets" / "models"
    dst_dir = OUT / "models"
    dst_dir.mkdir(parents=True, exist_ok=True)
    for old in dst_dir.glob("*.glb"):
        old.unlink()
    for glb in sorted(src_dir.glob("*.glb")) if src_dir.exists() else []:
        dst = dst_dir / glb.name
        bounds[glb.stem] = quantize_glb(glb, dst)
        models.append(glb.stem)
        print(f"{glb.name:28s} -> {dst.relative_to(ROOT)} ({glb.stat().st_size / 1e6:.1f} -> {dst.stat().st_size / 1e6:.1f} MB)")
    write_model_bounds(bounds)
    manifest["models"] = models

    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f"\n{len(manifest)} files exported")


if __name__ == "__main__":
    main()
