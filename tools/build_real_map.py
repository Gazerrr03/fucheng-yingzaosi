"""真实地图 → 营建地图（public/data/plan/{id}.json）

输入（都放在本地，脚本不联网）：
  --dem       高程栅格，ESRI ASCII Grid（.asc）。投影坐标（米），例如 UTM 48N（重庆）。
              来源建议：1950～60 年代 1:5 万地形图等高线数字化后插值；没有时用 SRTM 30 m
              （GDAL 转换：gdalwarp -t_srs EPSG:32648 -tr 30 30 srtm.tif dem.tif && gdal_translate -of AAIGrid dem.tif dem.asc）。
  --ring      可建范围（绕城高速），GeoJSON，Polygon 或 LineString（首尾自动闭合），与 DEM 同一投影。
  --rivers    大江（可选），GeoJSON LineString / MultiLineString / Polygon，与 DEM 同一投影。
  --water     湖塘、小河（可选），同上。建议用老地形图上的水系，把已经填掉的湖塘补回来。
  --labels    地名（可选），GeoJSON Point，properties.name。
  --origin    世界坐标原点（投影坐标 x,y），例如朝天门。不给则取范围中心。

地形分类规则（可调）：
  - 落在 rivers 里或离 rivers 线小于 --river-width/2 → R
  - 落在 water 里或离 water 线小于 --stream-width/2 → W
  - 与周边（3 格）的高差 > --mountain-relief，或绝对高程 > --mountain-elev → S
  - 高差 > --hill-relief → H
  - 其余 → T（田野），坡度很缓且靠近水的少数格 → G（村落，仅作点缀）

示例：
  python3 tools/build_real_map.py --id chongqing --name 重庆 --dem data_raw/cq_dem.asc \\
      --ring data_raw/cq_ring.geojson --rivers data_raw/cq_rivers.geojson --water data_raw/cq_ponds.geojson \\
      --labels data_raw/cq_labels.geojson --origin 657000,3270000 --hex 300
"""

import argparse
import json
import math
import os

SQRT3 = math.sqrt(3)
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- 读入


def read_asc(path):
    head = {}
    with open(path, encoding="ascii") as f:
        for _ in range(6):
            line = f.readline().split()
            head[line[0].lower()] = float(line[1])
        data = [list(map(float, line.split())) for line in f if line.strip()]
    ncols, nrows = int(head["ncols"]), int(head["nrows"])
    cell = head["cellsize"]
    x0 = head.get("xllcorner", head.get("xllcenter", 0) - cell / 2)
    y0 = head.get("yllcorner", head.get("yllcenter", 0) - cell / 2)
    nodata = head.get("nodata_value", -9999)
    assert len(data) == nrows and all(len(r) == ncols for r in data), "ASC 行列数与文件头不符"

    def sample(x, y):
        """双线性插值；越界或无数据返回 None"""
        fx = (x - x0) / cell - 0.5
        fy = (y0 + nrows * cell - y) / cell - 0.5  # 第 0 行在最北
        ix, iy = math.floor(fx), math.floor(fy)
        if ix < 0 or iy < 0 or ix + 1 >= ncols or iy + 1 >= nrows:
            return None
        tx, ty = fx - ix, fy - iy
        vals = [data[iy][ix], data[iy][ix + 1], data[iy + 1][ix], data[iy + 1][ix + 1]]
        if any(v == nodata for v in vals):
            return None
        a, b, c, d = vals
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty

    bounds = (x0, y0, x0 + ncols * cell, y0 + nrows * cell)
    return sample, bounds


def read_geojson(path):
    """返回 (polygons, lines, points)，坐标都是 [(x, y), ...]"""
    with open(path, encoding="utf-8") as f:
        gj = json.load(f)
    feats = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
    polys, lines, points = [], [], []
    for ft in feats:
        g = ft.get("geometry", ft)
        props = ft.get("properties") or {}
        t, c = g["type"], g["coordinates"]
        if t == "Polygon":
            polys.append([tuple(p[:2]) for p in c[0]])
        elif t == "MultiPolygon":
            polys += [[tuple(p[:2]) for p in poly[0]] for poly in c]
        elif t == "LineString":
            lines.append([tuple(p[:2]) for p in c])
        elif t == "MultiLineString":
            lines += [[tuple(p[:2]) for p in ln] for ln in c]
        elif t == "Point":
            points.append((tuple(c[:2]), props.get("name", "")))
    return polys, lines, points


# ---------------------------------------------------------------- 几何


def point_in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def dist_to_line(x, y, pts):
    best = float("inf")
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        L = dx * dx + dy * dy
        t = 0 if L == 0 else max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / L))
        best = min(best, math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best


def hex_to_world(q, r, size):
    return size * SQRT3 * (q + r / 2), size * 1.5 * r


def world_to_hex(x, y, size):
    fq = (SQRT3 / 3 * x - y / 3) / size
    fr = (2 / 3 * y) / size
    fs = -fq - fr
    q, r, s = round(fq), round(fr), round(fs)
    dq, dr, ds = abs(q - fq), abs(r - fr), abs(s - fs)
    if dq > dr and dq > ds:
        q = -r - s
    elif dr > ds:
        r = -q - s
    return q, r


# ---------------------------------------------------------------- 主流程


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--dem", required=True)
    ap.add_argument("--ring", required=True)
    ap.add_argument("--ring-name", default="绕城高速")
    ap.add_argument("--rivers")
    ap.add_argument("--water")
    ap.add_argument("--labels")
    ap.add_argument("--origin", help="x,y（投影坐标）")
    ap.add_argument("--hex", type=float, default=300, help="格子对边距离（米）")
    ap.add_argument("--margin", type=float, default=3000, help="范围外多显示多少米")
    ap.add_argument("--river-width", type=float, default=900)
    ap.add_argument("--stream-width", type=float, default=250)
    ap.add_argument("--mountain-relief", type=float, default=120)
    ap.add_argument("--mountain-elev", type=float, default=520)
    ap.add_argument("--hill-relief", type=float, default=50)
    ap.add_argument("--elev-step", type=float, default=20)
    ap.add_argument("--real", action="store_true", help="数据来自实测（地图标为真实地图）")
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "data", "plan"))
    a = ap.parse_args()

    sample, _ = read_asc(a.dem)
    ring_polys, ring_lines, _ = read_geojson(a.ring)
    ring = ring_polys[0] if ring_polys else ring_lines[0]
    river_polys, river_lines = ([], [])
    if a.rivers:
        river_polys, river_lines, _ = read_geojson(a.rivers)
    water_polys, water_lines = ([], [])
    if a.water:
        water_polys, water_lines, _ = read_geojson(a.water)
    labels = read_geojson(a.labels)[2] if a.labels else []

    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    if a.origin:
        ox, oy = map(float, a.origin.split(","))
    else:
        ox, oy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    size = a.hex / SQRT3
    rect = (min(xs) - a.margin, min(ys) - a.margin, max(xs) + a.margin, max(ys) + a.margin)

    corners = [world_to_hex(x - ox, y - oy, size) for x in (rect[0], rect[2]) for y in (rect[1], rect[3])]
    qmin, qmax = min(c[0] for c in corners) - 2, max(c[0] for c in corners) + 2
    rmin, rmax = min(c[1] for c in corners) - 1, max(c[1] for c in corners) + 1

    # 第一遍：高程
    elev = {}
    for r in range(rmin, rmax + 1):
        for q in range(qmin, qmax + 1):
            wx, wy = hex_to_world(q, r, size)
            x, y = wx + ox, wy + oy
            if not (rect[0] <= x <= rect[2] and rect[1] <= y <= rect[3]):
                continue
            z = sample(x, y)
            if z is not None:
                elev[(q, r)] = z

    # 第二遍：分类
    def local_relief(q, r):
        zs = [elev[(q + dq, r + dr)] for dq in range(-3, 4) for dr in range(max(-3, -dq - 3), min(3, -dq + 3) + 1)
              if (q + dq, r + dr) in elev]
        return elev[(q, r)] - min(zs)

    cells = {}
    for (q, r), z in elev.items():
        wx, wy = hex_to_world(q, r, size)
        x, y = wx + ox, wy + oy
        if any(point_in_poly(x, y, p) for p in river_polys) or any(dist_to_line(x, y, ln) < a.river_width / 2 for ln in river_lines):
            code = "R"
        elif any(point_in_poly(x, y, p) for p in water_polys) or any(dist_to_line(x, y, ln) < a.stream_width / 2 for ln in water_lines):
            code = "W"
        else:
            rel = local_relief(q, r)
            if rel > a.mountain_relief or z > a.mountain_elev:
                code = "S"
            elif rel > a.hill_relief:
                code = "H"
            else:
                code = "T"
        cells[(q, r)] = (code, z)

    q0, q1 = min(k[0] for k in cells), max(k[0] for k in cells)
    r0, r1 = min(k[1] for k in cells), max(k[1] for k in cells)
    base = math.floor(min(z for _, z in cells.values()) / a.elev_step) * a.elev_step
    rows, erows = [], []
    for r in range(r0, r1 + 1):
        row, erow = "", ""
        for q in range(q0, q1 + 1):
            if (q, r) in cells:
                code, z = cells[(q, r)]
                row += code
                erow += DIGITS[max(0, min(35, round((z - base) / a.elev_step)))]
            else:
                row += "."
                erow += "0"
        rows.append(row)
        erows.append(erow)

    out = {
        "id": a.id,
        "name": a.name,
        "subtitle": a.subtitle,
        "kind": "real" if a.real else "sketch",
        "hexAcross": a.hex,
        "terrain": {"qMin": q0, "rMin": r0, "rows": rows},
        "elev": {"rows": erows, "step": a.elev_step, "base": base},
        "ring": [[round(x - ox), round(y - oy)] for x, y in ring],
        "ringName": a.ring_name,
        "labels": [{"hex": list(world_to_hex(x - ox, y - oy, size)), "name": n} for (x, y), n in labels if n],
        "note": "由 tools/build_real_map.py 从 DEM 与水系数据生成。",
        "source": " / ".join(os.path.basename(p) for p in (a.dem, a.ring, a.rivers, a.water) if p),
    }
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, f"{a.id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    counts = {}
    for code, _ in cells.values():
        counts[code] = counts.get(code, 0) + 1
    print(f"{path}: {len(cells)} 格，地形 {counts}")


if __name__ == "__main__":
    main()
