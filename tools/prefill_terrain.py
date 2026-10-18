"""根据底图颜色 + 城墙几何，给关卡自动预填地形，作为标定工具里人工修正的起点。

用法：python3 tools/prefill_terrain.py xiangyang [--preview out.png] [--write]
  --write   把结果写回 public/data/{city}.json 的 terrain 字段（其他字段保持不变）
  --preview 输出叠加预览图

地形代码与 src/game/terrain.ts 保持一致：
  .  无（底图外）   R 大江    W 河塘溪    M 护城河
  S  山            T 田野    G 村落关厢   B 城内坊市   C 城墙
"""
import argparse
import json
import re
import math
import pathlib

import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
SQRT3 = math.sqrt(3)

# 每座城的几何先验（世界坐标，米）：
#   city_poly      主城轮廓多边形（与标定参考点一致）
#   extra_city_img 附加城区（图像像素多边形）
#   is_river       判断某格的水是否属于大江
#   moat_within    距城轮廓这个距离内的水 = 护城河
#   is_mountain    只在这个范围里认山
CITY_RULES = {
    "xiangyang": {
        "city_poly": [(-1100, -800), (1100, -800), (1100, 800), (-1100, 800)],
        "extra_city_img": [[(1110, 248), (1236, 296), (1226, 348), (1120, 334)]],  # 东北外城
        "is_river": lambda x, y: y > 820,  # 北城墙以北的水 = 汉江
        "moat_within": 650,
        "is_mountain": lambda x, y: y < -1150,  # 城南岘山
    },
    "jingzhou": {
        "city_poly": [(-1800, -600), (1800, -600), (1800, 600), (-1800, 600)],
        "extra_city_img": [],
        "is_river": lambda x, y: y < -1300,  # 城南长江
        "moat_within": 500,
        "is_mountain": lambda x, y: y < -3200,  # 江南岸远山
    },
    "baoding": {
        "city_poly": [(-1400, -900), (900, -900), (900, 900), (-900, 900)],  # 西南外凸（靴城）
        "extra_city_img": [],
        "is_river": lambda x, y: False,  # 无大江，只有河网
        "moat_within": 520,
        "is_mountain": lambda x, y: x < -1900 or (x < -1100 and y < -1500),  # 西缘与西南的太行远山带
    },
}


def dist_to_poly(x, y, poly):
    if point_in_poly((x, y), poly):
        return 0.0
    best = float("inf")
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(x - x1 - t * dx, y - y1 - t * dy))
    return best


def solve_h(src, dst):
    a, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -x * v, -y * v]); b.append(v)
    h, *_ = np.linalg.lstsq(np.array(a, float), np.array(b, float), rcond=None)
    return np.append(h, 1).reshape(3, 3)


def apply_h(h, pts):
    p = np.c_[pts, np.ones(len(pts))] @ h.T
    return p[:, :2] / p[:, 2:3]


def hex_center(q, r, size):
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


def classify_pixels(img):
    hsv = np.asarray(img.convert("HSV")).astype(float)
    h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    water = (h > 150) & (h < 230) & (s > 0.08)
    green = (h >= 70) & (h <= 150) & (s > 0.12)
    dark = (v < 0.42) & ~water
    yellow = (h >= 38) & (h < 70) & (s > 0.25)
    return water, green, dark, yellow


def point_in_poly(pt, poly):
    x, y = pt
    inside = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("city")
    ap.add_argument("--preview")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    path = ROOT / "public" / "data" / f"{args.city}.json"
    level = json.loads(path.read_text())
    rules = CITY_RULES[args.city]
    img = Image.open(ROOT / "public" / "assets" / f"{level['map']}.webp").convert("RGB")
    W, H = img.size
    water, green, dark, _ = classify_pixels(img)

    pts = level["calibration"]["points"]
    k = W / level["calibration"].get("imageSize", [W, H])[0]  # 底图换成更高分辨率时，标定坐标按比例换算
    img2w = solve_h([(p["img"][0] * k, p["img"][1] * k) for p in pts], [p["world"] for p in pts])
    rules = dict(rules, extra_city_img=[[(x * k, y * k) for x, y in poly] for poly in rules["extra_city_img"]])
    w2img = np.linalg.inv(img2w)
    size = level["grid"]["hexAcross"] / SQRT3
    inr = size * SQRT3 / 2

    # 网格范围：底图四边采样到世界坐标
    edge = np.array([(W * i / 16, y) for i in range(17) for y in (0, H)] + [(x, H * i / 16) for i in range(17) for x in (0, W)])
    wb = apply_h(img2w, edge)
    bounds = level["grid"].get("bounds")
    if bounds:
        wb = np.clip(wb, [bounds[0], bounds[1]], [bounds[2], bounds[3]])
    hexes = [world_to_hex(x, y, size) for x, y in [(wb[:, 0].min(), wb[:, 1].min()), (wb[:, 0].max(), wb[:, 1].min()), (wb[:, 0].min(), wb[:, 1].max()), (wb[:, 0].max(), wb[:, 1].max())]]
    q_min = min(h[0] for h in hexes) - 2; q_max = max(h[0] for h in hexes) + 2
    r_min = min(h[1] for h in hexes) - 1; r_max = max(h[1] for h in hexes) + 1

    # 格内采样点（单位六边形内的规则点阵）
    offs = np.array([(dx, dy) for dx in np.linspace(-0.8, 0.8, 9) for dy in np.linspace(-0.8, 0.8, 9) if math.hypot(dx, dy) <= 0.85]) * inr

    poly = rules["city_poly"]
    margin = 0.02 * min(W, H)

    def in_city(wx, wy, cx, cy):
        if point_in_poly((wx, wy), poly):
            return True
        return any(point_in_poly((cx, cy), poly) for poly in rules["extra_city_img"])

    rows = []
    stats = {}
    for r in range(r_min, r_max + 1):
        row = []
        for q in range(q_min, q_max + 1):
            cx_w, cy_w = hex_center(q, r, size)
            (cx, cy), = apply_h(w2img, np.array([[cx_w, cy_w]]))
            if bounds and not (bounds[0] <= cx_w <= bounds[2] and bounds[1] <= cy_w <= bounds[3]):
                row.append("."); continue
            if not (margin < cx < W - margin and margin < cy < H - margin):
                row.append("."); continue
            samp = apply_h(w2img, offs + [cx_w, cy_w]).round().astype(int)
            ok = (samp[:, 0] >= 0) & (samp[:, 0] < W) & (samp[:, 1] >= 0) & (samp[:, 1] < H)
            sx, sy = samp[ok, 0], samp[ok, 1]
            fw = water[sy, sx].mean(); fg = green[sy, sx].mean(); fd = dark[sy, sx].mean()

            # 城墙：格内同时有城内和城外的采样点
            inside = [in_city(*w, *p) for w, p in zip(offs + [cx_w, cy_w], apply_h(w2img, offs + [cx_w, cy_w]))]
            share_in = sum(inside) / len(inside)
            near_moat = dist_to_poly(cx_w, cy_w, poly) < rules["moat_within"]
            if 0.08 < share_in < 0.92:
                code = "C"
            elif share_in >= 0.92:
                code = "B"
            elif rules["is_river"](cx_w, cy_w) and fw > 0.10:
                code = "R"
            elif near_moat and fw > 0.12:
                code = "M"
            elif fw > 0.22:
                code = "W"
            elif rules["is_mountain"](cx_w, cy_w) and (fg + fd) > 0.22:
                code = "S"
            elif fd > 0.17:
                code = "G"
            else:
                code = "T"
            row.append(code)
            stats[code] = stats.get(code, 0) + 1
        rows.append("".join(row))

    # 城墙：城内格中最外一圈（与城外相邻的格）
    grid = [list(row) for row in rows]
    dirs = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
    for ri in range(len(grid)):
        for qi in range(len(grid[ri])):
            if rows[ri][qi] != "B":
                continue
            for dq, dr in dirs:
                nq, nr = qi + dq, ri + dr
                n = rows[nr][nq] if 0 <= nr < len(rows) and 0 <= nq < len(rows[nr]) else "."
                if n not in "BC":
                    grid[ri][qi] = "C"
                    break
    rows = ["".join(r) for r in grid]
    stats = {}
    for row in rows:
        for c in row:
            if c != ".":
                stats[c] = stats.get(c, 0) + 1

    print(f"grid q[{q_min},{q_max}] r[{r_min},{r_max}]  ", dict(sorted(stats.items())))

    if args.preview:
        colors = {"R": (40, 90, 200), "W": (90, 160, 230), "M": (0, 200, 220), "S": (30, 110, 40), "T": (220, 200, 60),
                  "G": (170, 100, 60), "B": (200, 60, 60), "C": (40, 40, 40)}
        over = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(over)
        for ri, row in enumerate(rows):
            for qi, code in enumerate(row):
                if code == ".":
                    continue
                q, r = q_min + qi, r_min + ri
                cx_w, cy_w = hex_center(q, r, size)
                corners = [(cx_w + size * math.cos(math.radians(60 * k + 30)), cy_w + size * math.sin(math.radians(60 * k + 30))) for k in range(6)]
                poly = [tuple(p) for p in apply_h(w2img, np.array(corners))]
                d.polygon(poly, fill=colors[code] + (110,), outline=(0, 0, 0, 90))
        Image.alpha_composite(img.convert("RGBA"), over).save(args.preview)
        print("preview ->", args.preview)

    if args.write:
        level["terrain"] = {"qMin": q_min, "rMin": r_min, "rows": rows, "note": "由 tools/prefill_terrain.py 预填，之后在标定工具里人工修正"}
        text = json.dumps(level, ensure_ascii=False, indent=2)
        # 与 vite.config.ts 的 formatJSON 一致：纯数字短数组收成一行
        text = re.sub(r"\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]", lambda m: "[" + ", ".join(re.split(r",\s*", m.group(1))) + "]", text)
        path.write_text(text + "\n")
        print("written ->", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
