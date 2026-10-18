"""Archive a generated original and register its actual metadata; no image edits."""
import hashlib, json, shutil, struct, sys
from pathlib import Path

root = Path(__file__).resolve().parents[3]
spec = json.loads(Path(sys.argv[1]).read_text())
src = Path(spec.pop('source'))
dest = root / spec['dest']
dest.parent.mkdir(parents=True, exist_ok=True)
if dest.exists():
    raise FileExistsError(dest)
shutil.copy2(src, dest)
b = dest.read_bytes()
assert b[:8] == b'\x89PNG\r\n\x1a\n'
assert hashlib.sha256(src.read_bytes()).digest() == hashlib.sha256(b).digest()
w, h = struct.unpack('>II', b[16:24])
prompt_path = root / 'assets/raw/_management/prompts' / (dest.stem + '.txt')
prompt_path.write_text(spec.pop('prompt'))
record = {**spec, 'path':spec.pop('dest'), 'dimensions':[w,h], 'sha256':hashlib.sha256(b).hexdigest(), 'source_original':str(src), 'prompt_file':str(prompt_path.relative_to(root)), 'generator':'built-in image_gen', 'copy_verified':True}
mp = root / 'assets/raw/_management/manifest.json'
m = json.loads(mp.read_text())
m['assets'].append(record)
m['tasks'][record['task']] = record['status']
mp.write_text(json.dumps(m, ensure_ascii=False, indent=2))
print(json.dumps({'path':record['path'],'dimensions':[w,h],'status':record['status']},ensure_ascii=False))
