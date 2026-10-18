"""关卡数据自检：卡片引用、基因规则、地点重叠、标注落点。

用法：python3 tools/check_level.py xiangyang
"""
import json
import math
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from prefill_terrain import apply_h, solve_h, world_to_hex  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main(city: str) -> int:
    level = json.loads((ROOT / "public" / "data" / f"{city}.json").read_text())
    cards = json.loads((ROOT / "public" / "data" / "cards" / f"{city}.json").read_text())
    genes = {g["id"] for g in json.loads((ROOT / "data" / "genes.json").read_text())}
    problems, notes = [], []

    pts = level["calibration"]["points"]
    h = solve_h([p["img"] for p in pts], [p["world"] for p in pts])
    size = level["grid"]["hexAcross"] / math.sqrt(3)
    site_ids = {s["id"] for s in level["sites"]}

    # 地点重叠
    seen = {}
    for s in level["sites"]:
        (x, y), = apply_h(h, np.array([s["img"]], float))
        key = world_to_hex(x, y, size)
        if key in seen:
            problems.append(f"地点「{s['name']}」与「{seen[key]}」落在同一格 {key}")
        seen[key] = s["name"]
        for ref in s["cards"]:
            if ref not in cards:
                problems.append(f"地点「{s['name']}」引用的卡片 {ref} 不存在")
        if f"site:{s['id']}" not in cards:
            notes.append(f"地点「{s['name']}」没有 site:{s['id']} 简介")

    # 基因规则
    rules = level.get("genes", {})
    for g in genes:
        if g not in rules:
            problems.append(f"基因 {g} 没有点亮规则")
        if f"gene:{g}" not in cards:
            problems.append(f"基因 {g} 没有卡片文案")
    for g, r in rules.items():
        for sid in r["sites"]:
            if sid not in site_ids:
                problems.append(f"基因 {g} 的规则引用了不存在的地点 {sid}")
        refs = {s["id"] for s in level["sites"] if f"gene:{g}" in s["cards"]}
        if refs != set(r["sites"]):
            notes.append(f"基因 {g}：规则里的地点 {sorted(r['sites'])} 与挂了该卡的地点 {sorted(refs)} 不一致")

    # 拾遗是否都有地点承载
    lore_ids = {l["id"] for l in level.get("lore", [])}
    carried = {ref.split(":")[1] for s in level["sites"] for ref in s["cards"] if ref.startswith("lore:")}
    for lid in lore_ids - carried:
        problems.append(f"拾遗 {lid} 没有挂在任何地点上")
    for lid in lore_ids:
        if f"lore:{lid}" not in cards:
            problems.append(f"拾遗 {lid} 没有卡片文案")

    # 标注落在有地形的格上
    t = level.get("terrain")
    if t:
        for lab in level.get("labels", []):
            q, r = lab["hex"]
            ri, qi = r - t["rMin"], q - t["qMin"]
            code = t["rows"][ri][qi] if 0 <= ri < len(t["rows"]) and 0 <= qi < len(t["rows"][ri]) else "."
            if code == ".":
                problems.append(f"标注「{lab['name']}」所在格 {q},{r} 没有地形（可能在底图外）")
            if (q, r) in seen:
                notes.append(f"标注「{lab['name']}」与地点「{seen[(q, r)]}」同格，悬停时会被地点名称覆盖")

    print(f"[{city}] 地点 {len(level['sites'])}，基因规则 {len(rules)}，拾遗 {len(lore_ids)}，标注 {len(level.get('labels', []))}，卡片 {len([k for k in cards if not k.startswith('_')])}")
    for p in problems:
        print("  ✗", p)
    for n in notes:
        print("  ·", n)
    if not problems:
        print("  ✓ 没有发现阻断问题")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "xiangyang"))
