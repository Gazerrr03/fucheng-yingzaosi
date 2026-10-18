// 检查 assets/models/*.glb 是否能被游戏里的加载器使用，并给出体量提示。
// 用法：node tools/check_models.mjs [ID ...]

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets', 'models');
const SPEC = JSON.parse(readFileSync(join(ROOT, 'data', 'models.json'), 'utf8'));
const BLOCKING = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu', 'EXT_texture_webp'];
const TRI_WARN = 120_000;
const TRI_FAIL = 600_000;

function parseGLB(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 glb（缺少 glTF 魔数）');
  let json = null;
  for (let off = 12; off < buf.length; ) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
    off += 8 + len;
  }
  if (!json) throw new Error('缺少 JSON 块');
  return json;
}

const ids = process.argv.slice(2);
if (!existsSync(DIR)) {
  console.log('assets/models/ 不存在。请把模型按 {ID}.glb 命名后放进去。');
  process.exit(0);
}
// 参数可以是资产 ID，也可以是任意 .glb 文件路径（例如构件库示范的输出）
const paths = ids.filter((a) => a.endsWith('.glb'));
const idArgs = ids.filter((a) => !a.endsWith('.glb'));
const files = [
  ...(paths.length && !idArgs.length ? [] : readdirSync(DIR).filter((f) => f.endsWith('.glb') && (!idArgs.length || idArgs.includes(basename(f, '.glb'))))).map((f) => join(DIR, f)),
  ...paths,
];
if (!files.length) {
  console.log('assets/models/ 里还没有 .glb 文件。');
  process.exit(0);
}

let failed = 0;
for (const path of files) {
  const id = basename(path, '.glb');
  const problems = [], notes = [];
  let summary = '';
  try {
    const g = parseGLB(path);
    const required = g.extensionsRequired ?? [];
    const used = g.extensionsUsed ?? [];
    for (const e of [...new Set([...required, ...used])]) if (BLOCKING.includes(e)) problems.push(`使用了 ${e}，加载器不支持，请导出未压缩版本`);
    if ((g.buffers ?? []).some((b, i) => b.uri && !b.uri.startsWith('data:') && !(i === 0 && b.uri === undefined))) problems.push('引用外部 .bin，请导出单文件 glb');
    if (g.skins?.length) notes.push('含蒙皮（会按静态网格显示）');
    if (g.animations?.length) notes.push('含动画（会被忽略）');

    let tris = 0, prims = 0, textured = 0, vcolor = 0, noNormal = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const [mi, m] of (g.meshes ?? []).entries()) {
      // 量化模型（KHR_mesh_quantization，export_assets.py 输出）：反量化变换在节点上
      const node = (g.nodes ?? []).find((n) => n.mesh === mi) ?? {};
      for (const p of m.primitives) {
        if (p.mode !== undefined && p.mode !== 4) { notes.push('含非三角形图元（会被跳过）'); continue; }
        prims++;
        const count = p.indices !== undefined ? g.accessors[p.indices].count : g.accessors[p.attributes.POSITION].count;
        tris += Math.floor(count / 3);
        const pos = g.accessors[p.attributes.POSITION];
        const div = pos.normalized ? { 5122: 32767, 5120: 127 }[pos.componentType] ?? 1 : 1;
        const dq = (v, k) => (v / div) * (node.scale?.[k] ?? 1) + (node.translation?.[k] ?? 0);
        if (pos.min && pos.max) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], dq(pos.min[k], k)); max[k] = Math.max(max[k], dq(pos.max[k], k)); }
        if (p.attributes.NORMAL === undefined) noNormal++;
        if (p.attributes.COLOR_0 !== undefined) vcolor++;
        const mat = p.material !== undefined ? g.materials[p.material] : null;
        if (mat?.pbrMetallicRoughness?.baseColorTexture) textured++;
      }
    }
    if (!prims) problems.push('没有可绘制的三角形网格');
    if (tris > TRI_FAIL) problems.push(`${tris.toLocaleString()} 个三角面，过多（上限 ${TRI_FAIL.toLocaleString()}），请先减面`);
    else if (tris > TRI_WARN) notes.push(`${tris.toLocaleString()} 个三角面，建议减到 ${TRI_WARN.toLocaleString()} 以内`);
    if (noNormal) notes.push(`${noNormal} 个图元没有法线（明暗会变平）`);
    if (!textured && !vcolor) notes.push('纯色材质（无贴图），符合建模任务书的色板约定');
    const imgs = (g.images ?? []).map((im) => (im.bufferView !== undefined ? g.bufferViews[im.bufferView].byteLength : 0));
    const imgMB = imgs.reduce((a, b) => a + b, 0) / 1e6;
    if (imgMB > 8) notes.push(`贴图合计 ${imgMB.toFixed(1)} MB，偏大`);
    const b = SPEC[id]?.bounds;
    if (b && [0, 1, 2].some((k) => Math.abs(b[0][k] - min[k]) > 0.005 || Math.abs(b[1][k] - max[k]) > 0.005))
      problems.push(`data/models.json 里的 bounds 与模型包围盒不符（远景简模会按它摆放），请重新运行 python3 tools/export_assets.py --models-only`);
    if (!SPEC[id]) notes.push(`ID「${id}」不在 data/models.json 里，游戏不会用到它`);

    const size = max.map((v, k) => v - min[k]);
    const upAxis = size[1] >= Math.max(size[0], size[2]) * 1.6 && !/^K12/.test(id) ? '（高度远大于宽度，检查是否躺倒）' : '';
    summary = `${tris.toLocaleString()} 面 · ${prims} 图元 · 贴图 ${imgs.length} 张 ${imgMB.toFixed(1)} MB · 包围盒 ${size.map((v) => v.toFixed(2)).join(' × ')}${upAxis} · ${(statSync(path).size / 1e6).toFixed(1)} MB`;
  } catch (err) {
    problems.push(String(err.message ?? err));
  }
  const name = SPEC[id]?.name ? ` ${SPEC[id].name}` : '';
  console.log(`${problems.length ? '✗' : '✓'} ${id}${name}  ${summary}`);
  for (const p of problems) console.log(`    ✗ ${p}`);
  for (const n of notes) console.log(`    · ${n}`);
  if (problems.length) failed++;
}
console.log(`\n${files.length} 个模型，${failed} 个无法使用。确认无误后运行 python3 tools/export_assets.py --models-only 量化后写到运行时目录。`);
process.exit(failed ? 1 : 0);
