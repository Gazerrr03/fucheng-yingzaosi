"""Build the local asset review page without modifying any image."""
from pathlib import Path
import json, html
from collections import defaultdict

root = Path(__file__).resolve().parents[3]
raw = root / 'assets/raw'
m = json.loads((raw / '_management/manifest.json').read_text())
chosen = json.loads((raw / '_management/selected.json').read_text())
esc = html.escape
labels = {'T0':'主风格 01','T1':'襄阳 · 概念底图','T2':'荆州 · 概念底图','T3':'保定 · 概念底图','T4':'三城总览 · 概念图','T5':'云雾过渡','T6':'UI 素材','T7':'3D 资产概念图'}
status = {'user_selected':'用户已选定','reviewed_concept':'已目视检查 · 概念图','reviewed_raw_pending_delivery_size':'已目视检查 · 原始尺寸','reviewed_concept_limited_view_separation':'视角差异有限 · 待建模检查','reviewed_raw_pending_resolution_and_runtime':'透明通道已验证 · 待尺寸与运行验证','concept_pending_control_map':'待控制图校准','concept_pending_location_sketch':'待定位草图校准','concept_pending_gate_angle_review':'待核对门向与额外角楼','concept_pending_gate_passage_review':'待核对门洞贯通','concept_pending_courtyard_count_review':'待核对五进院落','concept_pending_geometry_review':'待核对空间结构'}
def relative(p): return str(Path(p).relative_to('assets/raw'))
def figure(a):
    path = relative(a['path'])
    dims = a.get('dimensions', [1536,1024])
    title = a.get('view',Path(path).stem)
    return f'<figure><a class="media" href="{esc(path)}" target="_blank"><img loading="lazy" src="{esc(path)}" alt="{esc(title)}"></a><figcaption>{esc(title)} · {dims[0]} × {dims[1]}<br><a href="{esc(path)}">{esc(Path(path).name)}</a></figcaption></figure>'
groups = defaultdict(list)
for a in chosen: groups[(a['task'],a.get('asset_id',a['key']))].append(a)
cards = []
for (task,key),items in groups.items():
    first = items[0]
    title = (key+' · '+first.get('label','')) if task=='T7' else labels[task]+' · '+key
    notes = sorted(set(status.get(a['status'],a['status']) for a in items))
    imgs = ''.join(figure(a) for a in items)
    prompts = ''.join(f'<a href="{esc(relative(a["prompt_file"]))}">{esc(a.get("view","提示词"))}</a> ' for a in items if a.get('prompt_file'))
    versions = []
    for a in m['assets']:
        if a['task']!=task: continue
        match = a.get('asset_id')==key if task=='T7' else Path(a['path']).stem.removesuffix('_v2')==key
        if match: versions.append(f'<li><a href="{esc(relative(a["path"]))}">{esc(Path(a["path"]).name)}</a> · {esc(a["status"])}</li>')
    cards.append(f'<article data-task="{task}" data-search="{esc(title.lower())}"><h2>{esc(title)}</h2><p class="status">{esc(" / ".join(notes))}</p><div class="figures">{imgs}</div><details><summary>提示词与版本记录</summary><p>{prompts}</p><ul>{"".join(versions)}</ul><p>{esc(first.get("visual_review","T0 01 已由用户选定。"))}</p></details></article>')
options = ''.join(f'<option value="{t}">{t} · {labels[t]}</option>' for t in labels)
page = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T0–T7 生成资产审阅</title><style>
:root{color-scheme:light;--paper:#f3efe5;--ink:#302f29;--line:#d8d0c1;--tile:#fffefa}*{box-sizing:border-box}body{font:15px/1.6 system-ui,-apple-system,sans-serif;margin:0;background:var(--paper);color:var(--ink)}header,main{max-width:1500px;margin:auto;padding:28px}h1{font-size:30px;margin:0 0 8px}header p{max-width:1040px;margin:8px 0}.note{padding:14px 18px;border-left:3px solid #9c6347;background:#ebe4d5}nav{position:sticky;top:0;background:#f3efe5f5;border-block:1px solid var(--line);padding:12px 28px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;z-index:2}input,select{font:inherit;padding:8px 12px;border:1px solid #bdb5a6;border-radius:4px;background:#fffefa}input{min-width:240px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:24px;padding-top:24px}article{padding:18px;background:var(--tile);border:1px solid var(--line);border-radius:5px;min-width:0}article[data-task="T7"]{grid-column:1/-1}h2{font-size:18px;margin:0 0 5px}.status{font-size:13px;color:#79513d;margin:0 0 14px}.figures{display:flex;gap:16px}figure{margin:0;min-width:0;flex:1}.media{display:block;background-color:#ded8ca;background-image:linear-gradient(45deg,#c9c4b9 25%,transparent 25%),linear-gradient(-45deg,#c9c4b9 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#c9c4b9 75%),linear-gradient(-45deg,transparent 75%,#c9c4b9 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0}body.dark .media{background:#292d30}body.paper .media{background:#f3efe5}img{display:block;width:100%;height:360px;object-fit:contain}article[data-task="T7"] img{height:470px}figcaption{font-size:12px;word-break:break-all;margin-top:8px;color:#66625a}a{color:#665337;text-underline-offset:3px}details{font-size:12px;margin-top:16px;border-top:1px solid var(--line);padding-top:10px}details p{overflow-wrap:anywhere}summary{cursor:pointer}article[hidden]{display:none}#count{font-size:13px;color:#696256}@media(max-width:700px){header,main{padding:18px}nav{padding:10px 18px}main{grid-template-columns:1fr}.figures{flex-direction:column}article[data-task="T7"] img{height:330px}h1{font-size:25px}}
</style></head><body><header><h1>T0–T7 · 生成资产审阅</h1><p>主风格：用户选定 01。当前推荐清单共 <strong>101 张</strong>：1 张主风格、4 张地图候选、4 张云雾、18 张 UI、74 张资产概念视图。共保留 128 次已归档生成结果，另有 1 份主风格副本。</p><div class="note">这里展示的是生成原图与概念候选。三城底图待控制图校准，总览待定位草图；地图与云雾尚未达到任务书最终尺寸。UI 保留生成原尺寸，接入前需缩至目标尺寸。T7 为图生 3D 的概念输入，尚未验证 GLB 或游戏运行效果。宾阳楼门向、公安水门贯通、保定府署院落数量等核验项仍保留。</div><p><a href="_management/selected.json">当前推荐清单</a> · <a href="_management/manifest.json">完整版本清单</a> · <a href="_management/file_audit.json">文件验证记录</a> · <a href="_management/QA.md">检查与剩余事项</a> · <a href="style-review.html">T0 四候选</a></p></header><nav><label>任务 <select id="task"><option value="all">全部</option>OPTIONS</select></label><input id="search" aria-label="搜索资产" placeholder="搜索 ID、名称或文件名"><label>图片背景 <select id="bg"><option value="">棋盘</option><option value="dark">深色</option><option value="paper">纸色</option></select></label><span id="count"></span></nav><main>CARDS</main><script>
const task=document.querySelector('#task'),search=document.querySelector('#search'),cards=[...document.querySelectorAll('article')];function filter(){let n=0;for(const c of cards){c.hidden=(task.value!=='all'&&c.dataset.task!==task.value)||!c.dataset.search.includes(search.value.toLowerCase().trim());if(!c.hidden)n++;}document.querySelector('#count').textContent=n+' 个资产组';}task.addEventListener('change',filter);search.addEventListener('input',filter);document.querySelector('#bg').addEventListener('change',e=>document.body.className=e.target.value);filter();</script></body></html>'''
(raw/'review.html').write_text(page.replace('OPTIONS',options).replace('CARDS',''.join(cards)))
print(f'Built review.html: {len(groups)} groups, {len(chosen)} current images')
