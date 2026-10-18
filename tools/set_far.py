"""把资产登记为「v2 精模 + v1 远景简模」：python3 tools/set_far.py ID [ID ...]
给 data/models.json 中的 {ID} 加 far = {ID}_far，并在其后插入 {ID}_far 条目（lodOf = ID）。"""
import json
import sys
from pathlib import Path

p = Path(__file__).resolve().parent.parent / 'data' / 'models.json'
d = json.loads(p.read_text())
out = {}
for k, v in d.items():
    if k.endswith('_far') and k[:-4] in sys.argv[1:]:
        continue
    out[k] = v
    if k in sys.argv[1:]:
        v['far'] = f'{k}_far'
        far = {kk: vv for kk, vv in v.items() if kk not in ('far', 'fallback')}
        far['name'] = v['name'] + '（远景简模）'
        far['lodOf'] = k
        out[f'{k}_far'] = far
p.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print('ok', [k for k in sys.argv[1:] if k in d])
