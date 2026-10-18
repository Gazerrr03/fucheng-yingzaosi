// 最小 glTF 2.0（.glb）加载器：网格、节点层级、baseColor 贴图 / 颜色、顶点色。
// 支持 KHR_mesh_quantization（整数位置 / 法线，由 tools/export_assets.py 生成）：加载时解码成浮点并烘进节点变换，
// 着色器拿到的仍是模型自身坐标（米）。
// 不支持：Draco / meshopt / KTX2 压缩、蒙皮、动画、多 UV。遇到 extensionsRequired 里的扩展会直接报错。

import { multiply as mul4, normalMatrix } from './math';

export interface Primitive {
  vao: WebGLVertexArrayObject;
  count: number;
  indexType: number | null;
  /** 节点层级烘焙出的模型矩阵 */
  matrix: Float32Array;
  texture: WebGLTexture | null;
  color: [number, number, number, number];
  hasVertexColor: boolean;
  /** glTF 材质名（我们的模型里就是色板名，如 brick、plaster），程序化贴图按它选纹理 */
  material: string;
}

export interface Model {
  primitives: Primitive[];
  /** 节点变换后的包围盒 */
  min: [number, number, number];
  max: [number, number, number];
  triangles: number;
}

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  min?: number[];
  max?: number[];
}

const SUPPORTED_EXT = new Set(['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_materials_emissive_strength', 'KHR_materials_specular', 'KHR_materials_ior', 'KHR_mesh_quantization']);
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as const;
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const FLOAT = 5126;

/** 属性位置：0 position，1 normal，2 uv，3 color，4 描边法线（按位置合并后的平滑法线） */
export async function loadGLB(gl: WebGL2RenderingContext, url: string): Promise<Model> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`读取 ${url} 失败：${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${url} 不是 glb 文件`);
  let json: any = null;
  let bin: ArrayBuffer | null = null;
  for (let off = 12; off < buf.byteLength; ) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = buf.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error(`${url} 缺少 JSON 块`);
  const unsupported = (json.extensionsRequired ?? []).filter((e: string) => !SUPPORTED_EXT.has(e));
  if (unsupported.length) throw new Error(`${url} 使用了不支持的扩展：${unsupported.join(', ')}（请导出未压缩的 glb）`);

  const buffers: ArrayBuffer[] = (json.buffers ?? []).map((b: any, i: number) => {
    if (b.uri === undefined && i === 0 && bin) return bin;
    if (typeof b.uri === 'string' && b.uri.startsWith('data:')) return dataUri(b.uri);
    throw new Error(`${url} 引用了外部 buffer（${b.uri}），请导出为单文件 glb`);
  });
  const viewBytes = (i: number): { data: ArrayBuffer; offset: number; length: number; stride?: number } => {
    const v = json.bufferViews[i];
    return { data: buffers[v.buffer], offset: v.byteOffset ?? 0, length: v.byteLength, stride: v.byteStride };
  };

  // ---- 贴图 ----
  const texCache = new Map<number, Promise<WebGLTexture | null>>();
  const loadTex = (index: number) => {
    if (!texCache.has(index)) texCache.set(index, uploadTexture(gl, json, index, viewBytes));
    return texCache.get(index)!;
  };

  // ---- 节点层级 ----
  const primitives: Primitive[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  const scene = json.scenes?.[json.scene ?? 0];
  const roots: number[] = scene?.nodes ?? json.nodes?.map((_: unknown, i: number) => i) ?? [];
  const todo: { prim: any; world: Float32Array }[] = [];

  const visit = (nodeIndex: number, parent: Float32Array) => {
    const node = json.nodes[nodeIndex];
    const world = mul4(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue; // 只要三角形
        todo.push({ prim, world });
      }
    }
    for (const c of node.children ?? []) visit(c, world);
  };
  for (const r of roots) visit(r, identity());
  // 逐个图元解码上传；连续占用主线程超过约 8 ms 就让出一次，精模在游玩中途加载时不卡帧
  let slice = performance.now();
  for (const { prim, world } of todo) {
    if (performance.now() - slice > 8) {
      await new Promise((r) => setTimeout(r, 0));
      slice = performance.now();
    }
    const p = await buildPrimitive(gl, json, prim, world, viewBytes, loadTex);
    primitives.push(p.primitive);
    triangles += p.triangles;
    expandBounds(min, max, p.localMin, p.localMax, p.matrix);
  }
  if (!primitives.length) throw new Error(`${url} 里没有可绘制的三角形网格`);
  return { primitives, min, max, triangles };
}

async function buildPrimitive(
  gl: WebGL2RenderingContext,
  json: any,
  prim: any,
  matrix: Float32Array,
  viewBytes: ViewBytes,
  loadTex: (i: number) => Promise<WebGLTexture | null>,
) {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const attr = prim.attributes;
  const pos: Accessor = json.accessors[attr.POSITION];
  const bindAttr = (loc: number, accIndex: number | undefined) => {
    if (accIndex === undefined) return false;
    const acc: Accessor = json.accessors[accIndex];
    if (acc.bufferView === undefined) return false;
    const v = viewBytes(acc.bufferView);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(v.data, v.offset, v.length), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, COMPONENTS[acc.type], acc.componentType, !!acc.normalized || acc.componentType !== 5126, v.stride ?? 0, acc.byteOffset ?? 0);
    return true;
  };
  const upload = (loc: number, data: Float32Array) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()!);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  };
  const p = readVec3(json, attr.POSITION, viewBytes);
  const n = attr.NORMAL !== undefined ? readVec3(json, attr.NORMAL, viewBytes) : null;
  // 量化的网格：反量化变换在节点上。把节点变换烘进顶点，图元矩阵改为单位阵，模型坐标仍以米为单位
  const quantized = pos.componentType !== FLOAT;
  if (quantized) {
    transformPoints(p, matrix);
    if (n) transformNormals(n, normalMatrix(matrix));
    matrix = identity();
  }
  upload(0, p);
  if (n) upload(1, n);
  else gl.vertexAttrib3f(1, 0, 1, 0);
  // 描边法线：平直着色的模型在棱角处顶点被拆开、法线各朝各的，直接外扩描边会在角上裂开。
  // 这里把同一位置的顶点法线求平均，单独作为描边用的法线。
  if (n) upload(4, smoothNormals(p, n));
  else gl.vertexAttrib3f(4, 0, 1, 0);
  const hasUv = bindAttr(2, attr.TEXCOORD_0);
  if (!hasUv) gl.vertexAttrib2f(2, 0, 0);
  const hasVertexColor = bindAttr(3, attr.COLOR_0);
  if (!hasVertexColor) gl.vertexAttrib4f(3, 1, 1, 1, 1);

  let count = pos.count;
  let indexType: number | null = null;
  if (prim.indices !== undefined) {
    const acc: Accessor = json.accessors[prim.indices];
    const v = viewBytes(acc.bufferView!);
    const start = v.offset + (acc.byteOffset ?? 0);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(v.data, start, acc.count * BYTES[acc.componentType]), gl.STATIC_DRAW);
    count = acc.count;
    indexType = acc.componentType;
  }
  gl.bindVertexArray(null);

  const mat = prim.material !== undefined ? json.materials[prim.material] : null;
  const pbr = mat?.pbrMetallicRoughness ?? {};
  // glTF 的 baseColorFactor 是线性值，游戏的着色在 sRGB 空间里做，先转换
  const lin = (pbr.baseColorFactor ?? [1, 1, 1, 1]) as number[];
  const color = [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2]), lin[3]] as [number, number, number, number];
  const texture = pbr.baseColorTexture && hasUv ? await loadTex(pbr.baseColorTexture.index) : null;

  return {
    primitive: { vao, count, indexType, matrix, texture, color, hasVertexColor, material: String(mat?.name ?? '') },
    triangles: Math.floor(count / 3),
    localMin: quantized || !pos.min ? rangeOf(p, Math.min) : (pos.min as [number, number, number]),
    localMax: quantized || !pos.max ? rangeOf(p, Math.max) : (pos.max as [number, number, number]),
    matrix,
  };
}

async function uploadTexture(
  gl: WebGL2RenderingContext,
  json: any,
  index: number,
  viewBytes: (i: number) => { data: ArrayBuffer; offset: number; length: number },
): Promise<WebGLTexture | null> {
  const tex = json.textures?.[index];
  const img = tex !== undefined ? json.images?.[tex.source] : undefined;
  if (!img) return null;
  let blob: Blob;
  if (img.bufferView !== undefined) {
    const v = viewBytes(img.bufferView);
    blob = new Blob([new Uint8Array(v.data, v.offset, v.length)], { type: img.mimeType ?? 'image/png' });
  } else if (typeof img.uri === 'string' && img.uri.startsWith('data:')) {
    blob = new Blob([dataUri(img.uri)]);
  } else {
    return null;
  }
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const sampler = tex.sampler !== undefined ? json.samplers?.[tex.sampler] : undefined;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, sampler?.wrapS ?? gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, sampler?.wrapT ?? gl.REPEAT);
  bitmap.close();
  return t;
}

function nodeMatrix(node: any): Float32Array {
  if (node.matrix) return Float32Array.from(node.matrix);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return Float32Array.from([
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

const identity = () => Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** 把局部包围盒的 8 个角变换到世界后扩展总包围盒。 */
function expandBounds(min: number[], max: number[], lmin: number[], lmax: number[], m: Float32Array) {
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? lmax[0] : lmin[0], y = i & 2 ? lmax[1] : lmin[1], z = i & 4 ? lmax[2] : lmin[2];
    const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], w[k]);
      max[k] = Math.max(max[k], w[k]);
    }
  }
}

function dataUri(uri: string): ArrayBuffer {
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

type ViewBytes = (i: number) => { data: ArrayBuffer; offset: number; length: number; stride?: number };

/** 读取 VEC3 访问器为浮点（考虑 byteStride；整数按 normalized 规则换算）。 */
function readVec3(json: any, accIndex: number, viewBytes: ViewBytes): Float32Array {
  const acc: Accessor = json.accessors[accIndex];
  const out = new Float32Array(acc.count * 3);
  if (acc.bufferView === undefined || !acc.count) return out;
  const v = viewBytes(acc.bufferView);
  const size = BYTES[acc.componentType];
  const stride = v.stride ?? size * 3;
  const start = v.offset + (acc.byteOffset ?? 0);
  // 有符号归一化：max(c / (2^(b-1) - 1), -1)；无符号：c / (2^b - 1)
  const scale = !acc.normalized || acc.componentType === FLOAT ? 1 : { 5122: 32767, 5123: 65535, 5120: 127, 5121: 255 }[acc.componentType as 5122]!;
  const lo = scale === 1 ? -Infinity : -1;
  const Typed = { 5126: Float32Array, 5122: Int16Array, 5123: Uint16Array, 5120: Int8Array, 5121: Uint8Array }[acc.componentType as 5126];
  if (Typed && start % size === 0 && stride % size === 0) {
    // 对齐时直接按类型数组读，几十万顶点的精模解码快很多
    const step = stride / size;
    const src = new Typed(v.data, start, (acc.count - 1) * step + 3);
    for (let i = 0, j = 0; i < acc.count; i++, j += step) {
      out[i * 3] = Math.max(src[j] / scale, lo);
      out[i * 3 + 1] = Math.max(src[j + 1] / scale, lo);
      out[i * 3 + 2] = Math.max(src[j + 2] / scale, lo);
    }
    return out;
  }
  const dv = new DataView(v.data, start);
  const get: (o: number) => number = {
    5126: (o: number) => dv.getFloat32(o, true),
    5122: (o: number) => dv.getInt16(o, true),
    5123: (o: number) => dv.getUint16(o, true),
    5120: (o: number) => dv.getInt8(o),
    5121: (o: number) => dv.getUint8(o),
  }[acc.componentType as 5126 | 5122 | 5123 | 5120 | 5121];
  if (!get) throw new Error(`不支持的顶点分量类型 ${acc.componentType}`);
  for (let i = 0; i < acc.count; i++)
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.max(get(i * stride + c * size) / scale, lo);
  return out;
}

function transformPoints(p: Float32Array, m: Float32Array): void {
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    p[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    p[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    p[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
}

function transformNormals(n: Float32Array, m: Float32Array): void {
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i], y = n[i + 1], z = n[i + 2];
    const a = m[0] * x + m[3] * y + m[6] * z, b = m[1] * x + m[4] * y + m[7] * z, c = m[2] * x + m[5] * y + m[8] * z;
    const l = Math.hypot(a, b, c) || 1;
    n[i] = a / l; n[i + 1] = b / l; n[i + 2] = c / l;
  }
}

function rangeOf(p: Float32Array, pick: (a: number, b: number) => number): [number, number, number] {
  const r: [number, number, number] = p.length ? [p[0], p[1], p[2]] : [0, 0, 0];
  for (let i = 3; i < p.length; i += 3) for (let k = 0; k < 3; k++) r[k] = pick(r[k], p[i + k]);
  return r;
}

/** 同一位置（量化到 0.1 毫米）的顶点法线取平均。用开放寻址的整数哈希表分组，几十万顶点也只要几毫秒。 */
function smoothNormals(pos: Float32Array, nor: Float32Array): Float32Array {
  const count = pos.length / 3;
  const q = new Int32Array(pos.length);
  for (let i = 0; i < pos.length; i++) q[i] = Math.round(pos[i] * 1e4);
  let size = 1;
  while (size < count * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const group = new Int32Array(count);
  const sums = new Float32Array(pos.length);
  for (let v = 0; v < count; v++) {
    const x = q[v * 3], y = q[v * 3 + 1], z = q[v * 3 + 2];
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
    for (;;) {
      const r = table[h];
      if (r < 0) { table[h] = v; group[v] = v; break; }
      if (q[r * 3] === x && q[r * 3 + 1] === y && q[r * 3 + 2] === z) { group[v] = r; break; }
      h = (h + 1) & (size - 1);
    }
    const g = group[v] * 3;
    sums[g] += nor[v * 3]; sums[g + 1] += nor[v * 3 + 1]; sums[g + 2] += nor[v * 3 + 2];
  }
  const out = new Float32Array(pos.length);
  for (let v = 0; v < count; v++) {
    const g = group[v] * 3;
    const x = sums[g], y = sums[g + 1], z = sums[g + 2];
    const l = Math.hypot(x, y, z) || 1;
    out[v * 3] = x / l; out[v * 3 + 1] = y / l; out[v * 3 + 2] = z / l;
  }
  return out;
}
