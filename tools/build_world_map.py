"""天下舆图：tools/geo/china.py 的经纬度底稿 → 六边形大地图 public/data/world/ming.json

投影用 Albers 等积圆锥（标准纬线 25°N、47°N，中央经线 111°E），与常见中国全图一致；
网格是尖顶六边形（同游戏里的营建网格，同文明 6），每格对边距离 --hex 公里。

  python3 tools/build_world_map.py            # 默认 28 公里一格
  python3 tools/build_world_map.py --hex 24 --preview /tmp/world.png

地形代码：O 深海、Q 近海、W 湖、F 平原、H 丘陵、S 山地、X 雪山、P 高原、D 荒漠、C 草原
地物代码：f 林、m 泽、. 无
"""

import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "geo"))
import china as G  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SQRT3 = math.sqrt(3)
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
R_EARTH = 6371.0

# ---------------------------------------------------------------- 投影


class Albers:
    def __init__(self, lon0=111.0, lat0=30.0, lat1=25.0, lat2=47.0):
        p1, p2, p0 = map(math.radians, (lat1, lat2, lat0))
        self.lon0 = math.radians(lon0)
        self.n = (math.sin(p1) + math.sin(p2)) / 2
        self.C = math.cos(p1) ** 2 + 2 * self.n * math.sin(p1)
        self.rho0 = R_EARTH * math.sqrt(self.C - 2 * self.n * math.sin(p0)) / self.n

    def fwd(self, lon, lat):
        rho = R_EARTH * math.sqrt(self.C - 2 * self.n * math.sin(math.radians(lat))) / self.n
        th = self.n * (math.radians(lon) - self.lon0)
        return rho * math.sin(th), self.rho0 - rho * math.cos(th)

    def inv(self, x, y):
        dy = self.rho0 - y
        rho = math.hypot(x, dy)
        th = math.atan2(x, dy)
        lon = math.degrees(self.lon0 + th / self.n)
        s = (self.C - (rho * self.n / R_EARTH) ** 2) / (2 * self.n)
        return lon, math.degrees(math.asin(max(-1.0, min(1.0, s))))


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


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def line_dist(px, py, line):
    return min(seg_dist(px, py, *line[i], *line[i + 1]) for i in range(len(line) - 1))


def poly_dist(px, py, poly):
    """到多边形边界的距离；在内部为负"""
    d = line_dist(px, py, poly + [poly[0]])
    return -d if point_in_poly(px, py, poly) else d


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# 简单值噪声（确定性）
def _hash(ix, iy, seed):
    h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def vnoise(x, y, seed=0):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = _hash(ix, iy, seed), _hash(ix + 1, iy, seed)
    c, d = _hash(ix, iy + 1, seed), _hash(ix + 1, iy + 1, seed)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy


def fbm(x, y, seed=0):
    return 0.55 * vnoise(x, y, seed) + 0.3 * vnoise(x * 2.03, y * 2.03, seed + 7) + 0.15 * vnoise(x * 4.1, y * 4.1, seed + 13)


# ---------------------------------------------------------------- 主流程


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hex", type=float, default=28.0, help="每格对边距离（公里）")
    ap.add_argument("--out", default=os.path.join(ROOT, "public/data/world/ming.json"))
    ap.add_argument("--preview", help="另存一张 PNG 预览（需要 Pillow）")
    args = ap.parse_args()

    pj = Albers()
    P = lambda pts: [pj.fwd(lon, lat) for lon, lat in pts]  # noqa: E731

    coast = P(G.COAST)
    (lo0, lo1), (la0, la1) = G.BOUNDS["lon"], G.BOUNDS["lat"]
    # 大陆：海岸线 + 沿图边绕回（西南角 → 西北角 → 东北角）
    land_polys = [coast + P([(lo0, la0), (lo0, la1), (lo1, la1)])]
    land_polys += [P(pts) for pts in G.ISLANDS.values()]
    domain = P(G.DOMAIN)
    plateaus = [(name, h, P(pts)) for name, h, pts in G.PLATEAUS]
    basins = [(name, h, P(pts)) for name, h, pts in G.BASINS]
    deserts = [P(pts) for pts in G.DESERTS]
    ridges = [(name, P(pts), h, w) for name, pts, h, w in G.RIDGES]
    lakes = []
    for name, (lon, lat), rx, ry in G.LAKES:
        cx, cy = pj.fwd(lon, lat)
        lakes.append((name, cx, cy, rx, ry))

    # 内接矩形：西边取经线 lo0 上最靠东的点，东边取经线 lo1 上最靠西的点；南北同理
    lats = [la0 + (la1 - la0) * i / 50 for i in range(51)]
    lons = [lo0 + (lo1 - lo0) * i / 50 for i in range(51)]
    xa = max(pj.fwd(lo0, la)[0] for la in lats)
    xb = min(pj.fwd(lo1, la)[0] for la in lats)
    ya = max(pj.fwd(lo, la0)[1] for lo in lons)
    yb = min(pj.fwd(lo, la1)[1] for lo in lons)

    size = args.hex / SQRT3
    r_min, r_max = math.ceil(ya / (1.5 * size)), math.floor(yb / (1.5 * size))
    cells = {}
    for r in range(r_min, r_max + 1):
        y = 1.5 * size * r
        q0 = math.ceil(xa / (SQRT3 * size) - r / 2)
        q1 = math.floor(xb / (SQRT3 * size) - r / 2)
        for q in range(q0, q1 + 1):
            x = SQRT3 * size * (q + r / 2)
            cells[(q, r)] = {"x": x, "y": y}
    print(f"{len(cells)} 格，r {r_min}..{r_max}")

    # ---- 逐格：陆海、高程、湖 ----
    for (q, r), c in cells.items():
        x, y = c["x"], c["y"]
        lon, lat = pj.inv(x, y)
        c["lon"], c["lat"] = lon, lat
        c["land"] = any(point_in_poly(x, y, poly) for poly in land_polys)
        c["dom"] = point_in_poly(x, y, domain)
        c["lake"] = None
        for name, cx, cy, rx, ry in lakes:
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1:
                c["lake"] = name
        if not c["land"]:
            c["elev"] = 0
            continue
        # 低地：自东向西缓升
        e = 25 + max(0.0, 117.5 - lon) * 38
        for _, h, poly in plateaus:
            d = poly_dist(x, y, poly)
            e = max(e, h * (1 - smoothstep(-40, 70, d)))
        for _, h, poly in basins:
            d = poly_dist(x, y, poly)
            k = 1 - smoothstep(-50, 10, d)
            e = e * (1 - k) + h * k
        ridge = 0.0
        for _, line, h, w in ridges:
            d = line_dist(x, y, line)
            if d < w * 3:
                ridge = max(ridge, h * math.exp(-((d / w) ** 2)))
        c["ridge"] = ridge
        e = max(e, ridge) + 0.25 * min(ridge, e)
        n = fbm(x / 140, y / 140, 3)
        e = e * (0.86 + 0.28 * n) + 40 * (n - 0.5)
        c["elev"] = max(5.0, e)
        c["desert"] = any(point_in_poly(x, y, poly) for poly in deserts)

    # 小湖至少一格
    for name, cx, cy, rx, ry in lakes:
        if not any(c["lake"] == name for c in cells.values()):
            best = min(cells.values(), key=lambda c: (c["x"] - cx) ** 2 + (c["y"] - cy) ** 2)
            best["lake"] = name

    dirs = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]

    def nbrs(q, r):
        for dq, dr in dirs:
            n = cells.get((q + dq, r + dr))
            if n:
                yield n

    # ---- 河道：折线 → 相邻六边形链 ----
    def hex_of(x, y):
        fq = (SQRT3 / 3 * x - y / 3) / size
        fr = (2 / 3 * y) / size
        fs = -fq - fr
        rq, rr, rs = round(fq), round(fr), round(fs)
        dq, dr, ds = abs(rq - fq), abs(rr - fr), abs(rs - fs)
        if dq > dr and dq > ds:
            rq = -rr - rs
        elif dr > ds:
            rr = -rq - rs
        return rq, rr

    rivers_out = []
    for name, rank, pts in G.RIVERS:
        line = P(pts)
        path = []
        for i in range(len(line) - 1):
            (ax, ay), (bx, by) = line[i], line[i + 1]
            steps = max(1, int(math.hypot(bx - ax, by - ay) / 4))
            for s in range(steps + 1):
                h = hex_of(ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps)
                if h not in cells:
                    continue
                if path and path[-1] == h:
                    continue
                if len(path) >= 2 and path[-2] == h:  # 来回抖动
                    path.pop()
                    continue
                path.append(h)
        if len(path) >= 2:
            rivers_out.append({"name": name, "rank": rank, "path": [list(h) for h in path]})
            for h in path:
                c = cells[h]
                cur = c.get("river")
                rk = 0 if rank == "canal" else rank
                if cur is None or (rk and rk < cur):
                    c["river"] = rk

    # ---- 地形分类 ----
    for (q, r), c in cells.items():
        if not c["land"]:
            continue
        rel = max((abs(c["elev"] - n["elev"]) for n in nbrs(q, r) if n["land"]), default=0)
        c["relief"] = rel
    for (q, r), c in cells.items():
        if not c["land"]:
            c["t"] = "Q" if any(n["land"] for n in nbrs(q, r)) else "O"
            continue
        if c["lake"]:
            c["t"] = "W"
            continue
        e, rel, ridge = c["elev"], c["relief"], c["ridge"]
        if e > 5300 or (ridge > 4300 and e > 4900):
            t = "X"
        elif (e > 2200 and rel > 380) or rel > 800 or (ridge > 1500 and ridge > 0.62 * e):
            t = "S"
        elif e > 2900:
            t = "P"
        elif rel > 190 or (ridge > 650 and ridge > 0.5 * e):
            t = "H"
        elif c["desert"]:
            t = "D"
        elif not c["dom"] and c["lat"] > 39.3:
            t = "C"
        else:
            t = "F"
        c["t"] = t

    # ---- 地物：南方丘陵多林，大江大湖边低地多泽 ----
    for (q, r), c in cells.items():
        c["f"] = "."
        t = c.get("t")
        if t not in ("F", "H", "S"):
            continue
        n = fbm(c["x"] / 60, c["y"] / 60, 11)
        wet = any(nb.get("t") == "W" for nb in nbrs(q, r)) or c.get("river") == 1
        if t == "F" and wet and c["elev"] < 80 and n > 0.58:
            c["f"] = "m"
        elif t in ("H", "S") and c["lat"] < 34 and n > 0.38:
            c["f"] = "f"
        elif t == "H" and n > 0.62:
            c["f"] = "f"
        elif t == "F" and c["lat"] < 27 and n > 0.66:
            c["f"] = "f"

    # 府城所在格必是陆地（岳州等滨湖之城）
    def cell_at(lon, lat):
        return hex_of(*pj.fwd(lon, lat))

    cities_out = []
    for name, lon, lat, prov, extra in G.CITIES:
        h = cell_at(lon, lat)
        if h not in cells:
            continue
        c = cells[h]
        if c["t"] in ("W", "Q", "O"):
            c["t"], c["land"] = "F", True
            c["elev"] = max(c["elev"], 20)
        item = {"name": name, "hex": list(h), "prov": prov}
        item.update(extra)
        cities_out.append(item)

    provinces_out = [{"name": n, "hex": list(cell_at(lon, lat))} for n, lon, lat in G.PROVINCES]
    lake_labels = []
    for name, cx, cy, rx, ry in lakes:
        lake_labels.append({"name": name, "hex": list(hex_of(cx, cy))})
    ridge_labels = []
    for name, line, h, w in ridges:
        if h < 1200:
            continue
        mx, my = line[len(line) // 2] if len(line) > 2 else ((line[0][0] + line[-1][0]) / 2, (line[0][1] + line[-1][1]) / 2)
        hh = hex_of(mx, my)
        if hh in cells:
            ridge_labels.append({"name": name, "hex": list(hh)})

    # ---- 输出 ----
    q_min = min(q for q, _ in cells)
    q_max = max(q for q, _ in cells)
    step = 150

    def rows(fn):
        out = []
        for r in range(r_min, r_max + 1):
            out.append("".join(fn(cells[(q, r)]) if (q, r) in cells else "." for q in range(q_min, q_max + 1)))
        return out

    data = {
        "id": "ming",
        "name": "大明舆图",
        "subtitle": "两京十三布政使司 · 明代河道",
        "hexKm": args.hex,
        "projection": {"type": "albers", "lon0": 111, "lat0": 30, "lat1": 25, "lat2": 47},
        "terrain": {"qMin": q_min, "rMin": r_min, "rows": rows(lambda c: c["t"])},
        "elev": {"step": step, "rows": rows(lambda c: DIGITS[min(35, int(round(c["elev"] / step)))])},
        "feature": rows(lambda c: c["f"]),
        "domain": rows(lambda c: "1" if c["dom"] else "0"),
        "rivers": rivers_out,
        "cities": cities_out,
        "provinces": provinces_out,
        "lakes": lake_labels,
        "ranges": ridge_labels,
        "note": "地理底稿为手工整理的经纬度（tools/geo/china.py），示意级；河道取明代（黄河夺淮入海）。",
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    counts = {}
    for c in cells.values():
        counts[c["t"]] = counts.get(c["t"], 0) + 1
    print("地形统计", dict(sorted(counts.items(), key=lambda kv: -kv[1])))
    print(f"写出 {args.out}（{os.path.getsize(args.out) // 1024} KB），{len(rivers_out)} 条河，{len(cities_out)} 座城")

    if args.preview:
        preview(cells, rivers_out, cities_out, size, args.preview)


def preview(cells, rivers, cities, size, path):
    from PIL import Image, ImageDraw

    col = {"O": (70, 110, 140), "Q": (110, 150, 170), "W": (120, 170, 185), "F": (205, 190, 130), "H": (175, 165, 105),
           "S": (125, 120, 90), "X": (235, 235, 240), "P": (165, 160, 120), "D": (220, 200, 150), "C": (170, 185, 120)}
    xs = [c["x"] for c in cells.values()]
    ys = [c["y"] for c in cells.values()]
    k = 3.0 / size * 2
    W, H = int((max(xs) - min(xs)) * k / 2 + 20), int((max(ys) - min(ys)) * k / 2 + 20)
    s = k / 2
    img = Image.new("RGB", (W, H), (60, 90, 120))
    d = ImageDraw.Draw(img)
    tx = lambda x: (x - min(xs)) * s + 10  # noqa: E731
    ty = lambda y: (max(ys) - y) * s + 10  # noqa: E731
    for c in cells.values():
        pts = [(tx(c["x"] + size * math.cos(math.radians(60 * i - 30))), ty(c["y"] + size * math.sin(math.radians(60 * i - 30)))) for i in range(6)]
        rgb = col[c["t"]]
        if c["land"] and not c["dom"]:
            rgb = tuple(int(v * 0.8) for v in rgb)
        if c["f"] == "f":
            rgb = tuple(int(v * 0.82) for v in rgb)
        d.polygon(pts, fill=rgb)
    for rv in rivers:
        pts = [(tx(SQRT3 * size * (q + r / 2)), ty(1.5 * size * r)) for q, r in rv["path"]]
        d.line(pts, fill=(60, 110, 160) if rv["rank"] != "canal" else (150, 80, 60), width=3 if rv["rank"] == 1 else 2)
    for ct in cities:
        q, r = ct["hex"]
        x, y = tx(SQRT3 * size * (q + r / 2)), ty(1.5 * size * r)
        d.rectangle([x - 2, y - 2, x + 2, y + 2], fill=(180, 40, 40))
    img.save(path)
    print("预览", path)


if __name__ == "__main__":
    main()
