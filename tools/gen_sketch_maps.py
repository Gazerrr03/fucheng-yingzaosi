"""生成示意级营建地图：public/data/plan/{wuchang,chongqing}.json

都是「按大势画出」的示意图，没有使用真实测绘数据：
- wuchang：明清武昌府城一带。长江在西，蛇山自江边向东横贯，城外有沙湖、南湖，江对岸是汉阳龟山。
- chongqing：重庆绕城高速以内，力求接近建国初期的地形：长江、嘉陵江在朝天门交汇，
  中梁山、铜锣山两道平行山岭南北走向，中间是丘陵和河谷，渝中半岛是一道山脊。
拿到真实 DEM 和老地形图后，用 tools/build_real_map.py 重新生成 chongqing。

用法：python3 tools/gen_sketch_maps.py
"""

import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data", "plan")
SQRT3 = math.sqrt(3)
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"


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


def hash01(ix, iy, seed):
    h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 0xFFFF


def value_noise(x, y, scale, seed):
    gx, gy = x / scale, y / scale
    ix, iy = math.floor(gx), math.floor(gy)
    fx, fy = gx - ix, gy - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = hash01(ix, iy, seed)
    b = hash01(ix + 1, iy, seed)
    c = hash01(ix, iy + 1, seed)
    d = hash01(ix + 1, iy + 1, seed)
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy


def fbm(x, y, scale, seed, octaves=4):
    v, amp, tot = 0.0, 1.0, 0.0
    for i in range(octaves):
        v += value_noise(x, y, scale / (2**i), seed + i) * amp
        tot += amp
        amp *= 0.5
    return v / tot


def dist_to_polyline(x, y, pts):
    best = float("inf")
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best


def build(rect, hex_across, classify):
    """rect = (xmin, ymin, xmax, ymax)，classify(x, y) -> (code, elev)"""
    size = hex_across / SQRT3
    xmin, ymin, xmax, ymax = rect
    corners = [world_to_hex(x, y, size) for x in (xmin, xmax) for y in (ymin, ymax)]
    qmin = min(c[0] for c in corners) - 2
    qmax = max(c[0] for c in corners) + 2
    rmin = min(c[1] for c in corners) - 1
    rmax = max(c[1] for c in corners) + 1
    cells = {}
    for r in range(rmin, rmax + 1):
        for q in range(qmin, qmax + 1):
            x, y = hex_to_world(q, r, size)
            if xmin <= x <= xmax and ymin <= y <= ymax:
                cells[(q, r)] = classify(x, y)
    qs = [k[0] for k in cells]
    rs = [k[1] for k in cells]
    q0, q1, r0, r1 = min(qs), max(qs), min(rs), max(rs)
    return cells, q0, q1, r0, r1, size


def encode(cells, q0, q1, r0, r1, step, base):
    rows, erows = [], []
    for r in range(r0, r1 + 1):
        row, erow = "", ""
        for q in range(q0, q1 + 1):
            if (q, r) in cells:
                code, elev = cells[(q, r)]
                row += code
                erow += DIGITS[max(0, min(35, round((elev - base) / step)))]
            else:
                row += "."
                erow += "0"
        rows.append(row)
        erows.append(erow)
    return {"qMin": q0, "rMin": r0, "rows": rows}, {"rows": erows, "step": step, "base": base}


def label(name, x, y, size):
    q, r = world_to_hex(x, y, size)
    return {"hex": [q, r], "name": name}


# ---------------------------------------------------------------- 武昌


def wuchang():
    # 坐标：米，原点在城中，x 向东，y 向北
    river_w = lambda y: -2200 + 0.3 * y  # 长江东岸
    snake = [(-2150, -80), (-1200, 0), (0, 60), (1300, 0)]  # 蛇山山脊（黄鹄矶 → 东）

    def classify(x, y):
        n = fbm(x, y, 900, 11)
        east_bank = river_w(y)
        if east_bank - 1500 < x < east_bank:
            return "R", 0
        if x <= east_bank - 1500:
            # 江对岸：汉阳，龟山
            d = math.hypot(x - (-4400 + 0.3 * y), y - 700)
            if d < 650:
                return "S", 55 + (650 - d) / 650 * 35
            if math.hypot(x - (-4600), y - 2600) < 500:
                return "W", 0
            return ("G" if n > 0.62 else "T"), 22
        d_snake = dist_to_polyline(x, y, snake)
        if d_snake < 170:
            return "S", 62 + (170 - d_snake) / 170 * 20 + n * 8
        if d_snake < 330:
            return "H", 34 + n * 6
        if math.hypot(x - 250, y - 1250) < 260:  # 凤凰山
            return "H", 38
        if math.hypot((x - 3000) / 1.3, y - 1800) < 820:  # 沙湖
            return "W", 0
        if math.hypot((x - 2100) / 1.4, y + 2700) < 780:  # 南湖
            return "W", 0
        if math.hypot(x + 950, y + 900) < 300:  # 紫阳湖
            return "W", 0
        return ("G" if n > 0.66 else "T"), 22 + n * 4

    cells, q0, q1, r0, r1, size = build((-5200, -3600, 4200, 3200), 200, classify)
    terrain, elev = encode(cells, q0, q1, r0, r1, 5, 0)
    return {
        "id": "wuchang",
        "name": "武昌府",
        "subtitle": "西临大江，蛇山横贯城中",
        "kind": "sketch",
        "hexAcross": 200,
        "terrain": terrain,
        "elev": elev,
        "terrainNames": {"R": "长江", "S": "蛇山"},
        "labels": [
            label("长江", -2900, -1500, size),
            label("蛇山", -200, 60, size),
            label("黄鹄矶", -2000, -60, size),
            label("沙湖", 3000, 1800, size),
            label("南湖", 2100, -2700, size),
            label("龟山", -4400, 700, size),
            label("汉阳", -4300, -1400, size),
        ],
        "note": "示意级地形：按明清武昌府城图的大势画出，比例与细节不准确。",
        "source": "tools/gen_sketch_maps.py",
    }


# ---------------------------------------------------------------- 重庆


def chongqing():
    # 坐标：米，原点在朝天门，x 向东，y 向北
    K = 1000
    yangtze = [(-23, -19), (-17, -15), (-13, -12), (-9, -7), (-6, -3.5), (-3.5, -1.8), (-1.2, -1.1), (0, 0),
               (2.2, 0.4), (4.5, 2.5), (7, 4.2), (10, 5.2), (13, 6.8), (19, 9)]
    jialing = [(-17, 24), (-13.5, 17), (-12.5, 11), (-11.5, 6.5), (-10, 3.2), (-7.5, 2.4), (-5, 1.6),
               (-3, 1.3), (-1.2, 0.8), (0, 0)]
    yangtze = [(x * K, y * K) for x, y in yangtze]
    jialing = [(x * K, y * K) for x, y in jialing]
    yuzhong = [(-7 * K, 0.4 * K), (-3.5 * K, 0), (-0.6 * K, -0.1 * K)]  # 渝中半岛山脊（鹅岭、枇杷山）
    # 绕城高速：示意多边形（顺时针，单位千米）
    ring = [(-6, 25), (6, 24), (13, 19), (17, 10), (18, 0), (16, -10), (10, -19), (0, -23), (-10, -22),
            (-19, -18), (-25, -9), (-27, 2), (-24, 13), (-16, 22)]
    ring = [(x * K, y * K) for x, y in ring]

    def ridge(x, y, x0, slope, width):
        cx = x0 + slope * y
        return max(0.0, 1 - abs(x - cx) / width)

    def classify(x, y):
        n = fbm(x, y, 3500, 7)
        n2 = fbm(x, y, 900, 9, 3)
        dy = dist_to_polyline(x, y, yangtze)
        dj = dist_to_polyline(x, y, jialing)
        if dy < 520 or dj < 300:
            return "R", 160
        # 两道平行山岭：中梁山（西）、铜锣山（东，南段即南山）
        zl = ridge(x, y, -19 * K, 0.12, 2600) if -26 * K < y < 26 * K else 0
        tl = ridge(x, y, 7.5 * K, 0.18, 2200) if -24 * K < y < 26 * K else 0
        yz = max(0.0, 1 - dist_to_polyline(x, y, yuzhong) / 900) if dy > 400 and dj > 300 else 0
        elev = 230 + n * 140 + n2 * 40
        elev += zl ** 0.7 * 380 + tl ** 0.7 * 330 + yz * 150
        # 河谷：离江越近越低
        valley = min(dy, dj)
        if valley < 2500:
            elev -= (1 - valley / 2500) * 70
        elev = max(175, elev)
        if elev > 470:
            code = "S"
        elif elev > 330:
            code = "H"
        elif n2 > 0.72 and valley > 1500:
            code = "W"  # 塘堰
        elif n2 > 0.6:
            code = "G"
        else:
            code = "T"
        if code == "W":
            elev = max(175, elev - 10)
        return code, elev

    cells, q0, q1, r0, r1, size = build((-29 * K, -25 * K, 20 * K, 27 * K), 300, classify)
    terrain, elev = encode(cells, q0, q1, r0, r1, 20, 160)
    return {
        "id": "chongqing",
        "name": "重庆",
        "subtitle": "两江交汇，山水之城（绕城高速以内）",
        "kind": "sketch",
        "hexAcross": 300,
        "terrain": terrain,
        "elev": elev,
        "ring": [[round(x), round(y)] for x, y in ring],
        "ringName": "绕城高速",
        "terrainNames": {"R": "长江", "S": "山岭"},
        "labels": [
            label("朝天门", 400, 200, size),
            label("长江", -11 * K, -9.6 * K, size),
            label("长江", 8 * K, 4.4 * K, size),
            label("嘉陵江", -11.8 * K, 9 * K, size),
            label("渝中半岛", -3.6 * K, 0.1 * K, size),
            label("中梁山", -19 * K, 6 * K, size),
            label("歌乐山", -16.5 * K, 1 * K, size),
            label("铜锣山", 9.5 * K, 12 * K, size),
            label("南山", 6.2 * K, -6 * K, size),
        ],
        "note": "示意级地形：长江、嘉陵江、中梁山、铜锣山、渝中半岛按大势画出，高程为程序生成，并非建国初期的实测数据。"
                "绕城高速范围为示意多边形。用 tools/build_real_map.py 和真实数据可重新生成。",
        "source": "tools/gen_sketch_maps.py",
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    for fn in (wuchang, chongqing):
        data = fn()
        path = os.path.join(OUT, f"{data['id']}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        n = sum(row.count(".") for row in data["terrain"]["rows"])
        total = sum(len(row) for row in data["terrain"]["rows"]) - n
        print(f"{path}: {total} 格, {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    main()
