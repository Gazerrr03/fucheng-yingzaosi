// 共用的 GLSL 片段：阴影采样、程序化材质纹理。

/** 方向光阴影：3 × 3 PCF，硬件比较采样（sampler2DShadow）。法线方向偏移以减少自阴影条纹。 */
export const SHADOW_GLSL = /* glsl */ `
uniform highp sampler2DShadow uShadow;
uniform mat4 uLightVP;
uniform float uShadowOn;
uniform float uShadowTexel;
float shadowAt(vec3 wpos, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 lp = uLightVP * vec4(wpos + n * 0.35, 1.0);
  vec3 c = lp.xyz / lp.w * 0.5 + 0.5;
  if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, vec3(1.0)))) return 1.0;
  // 4 次硬件比较采样（线性过滤下每次已是 2×2 混合），边缘柔和、开销低
  float s = 0.0;
  s += texture(uShadow, vec3(c.xy + vec2(-0.5, -0.5) * uShadowTexel, c.z - 0.0008));
  s += texture(uShadow, vec3(c.xy + vec2( 0.5, -0.5) * uShadowTexel, c.z - 0.0008));
  s += texture(uShadow, vec3(c.xy + vec2(-0.5,  0.5) * uShadowTexel, c.z - 0.0008));
  s += texture(uShadow, vec3(c.xy + vec2( 0.5,  0.5) * uShadowTexel, c.z - 0.0008));
  return s * 0.25;
}`;

/** 程序化材质：按材质类型在模型自身坐标（米）上算纹理，返回乘到底色上的系数。
 *  贴图太细、一个像素已超过几厘米时自动淡出，避免远处闪烁。
 *  类型：1 砖、2 石、3 粉墙、4 油饰木构、5 瓦面、6 夯土、7 树皮。 */
export const MATERIAL_GLSL = /* glsl */ `
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03) + 0.15 * vnoise(p * 4.01); }
float fbm2(vec2 p) { return 0.65 * vnoise(p) + 0.35 * vnoise(p * 2.03); }

/** 砌块：size 为一块的长 × 高（米），joint 为灰缝宽；返回 (灰缝 0..1, 块号哈希)。 */
vec2 blocks(vec2 uv, vec2 size, float joint, float stagger) {
  vec2 b = uv / size;
  float row = floor(b.y);
  b.x += stagger * mod(row, 2.0);
  vec2 f = fract(b);
  float d = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y);
  return vec2(1.0 - smoothstep(joint * 0.4, joint, d), hash2(floor(b)));
}

float surfaceDetail(int kind, vec3 p, vec3 n) {
  if (kind == 0) return 1.0;
  vec3 an = abs(n);
  bool topFace = an.y > max(an.x, an.z);
  vec2 uv = topFace ? p.xz : (an.x > an.z ? p.zy : p.xy);
  float mpp = max(fwidth(uv.x), fwidth(uv.y));              // 一个像素对应的米数
  float fine = 1.0 - smoothstep(0.015, 0.05, mpp);           // 砖缝级细节
  float mid = 1.0 - smoothstep(0.08, 0.35, mpp);             // 石块、木纹级
  float k = 1.0;
  float grime = fbm2(uv * 0.32);
  float ground = topFace ? 1.0 : mix(0.8, 1.0, smoothstep(0.0, 2.2, p.y));   // 墙根潮气
  if (kind == 1) {                                            // 砖
    vec2 b = topFace ? blocks(uv, vec2(0.46, 0.46), 0.012, 0.0) : blocks(uv, vec2(0.46, 0.13), 0.014, 0.5);
    k *= 1.0 + (b.y - 0.5) * 0.14 * fine;
    k *= 1.0 - b.x * 0.3 * fine;
    k *= 0.88 + 0.22 * grime;
    k *= ground;
  } else if (kind == 2) {                                     // 石
    vec2 b = blocks(uv, topFace ? vec2(0.9, 0.9) : vec2(1.05, 0.5), 0.012, 0.5);
    k *= 1.0 + (b.y - 0.5) * 0.1 * mid;
    k *= 1.0 - b.x * 0.25 * mid;
    k *= 0.94 + 0.1 * vnoise(uv * 18.0) * fine;
    k *= 0.92 + 0.14 * grime;
  } else if (kind == 3) {                                     // 粉墙：水渍、流痕
    float stain = fbm(uv * 0.55);
    float streak = vnoise(vec2(uv.x * 2.6, uv.y * 0.22));
    float low = 1.0 - smoothstep(0.3, 3.2, p.y);
    k *= 0.93 + 0.12 * stain;
    k *= 1.0 - streak * 0.1 * mid;
    k *= 1.0 - low * 0.1;
  } else if (kind == 4) {                                     // 油饰木构：顺纹 + 旧漆
    float grain = vnoise(vec2(uv.x * 1.2, uv.y * 22.0)) * 0.6 + vnoise(vec2(uv.y * 1.2, uv.x * 22.0)) * 0.4;
    k *= 1.0 + (grain - 0.5) * 0.1 * mid;
    k *= 0.95 + 0.08 * grime;
  } else if (kind == 5) {                                     // 瓦面
    k *= 0.92 + 0.14 * fbm(uv * 1.3);
  } else if (kind == 6) {                                     // 夯土：分层
    k *= 0.9 + 0.16 * fbm(uv * 0.9);
    k *= 1.0 - 0.06 * mid * step(0.8, fract(p.y / 0.18));
  } else if (kind == 7) {                                     // 树皮
    k *= 0.85 + 0.25 * vnoise(vec2(uv.x * 6.0, uv.y * 0.9));
  }
  return k;
}`;

/** 材质名 → 程序化纹理类型（与 MATERIAL_GLSL 的编号一致）。 */
export function materialKind(name: string): number {
  if (name.startsWith('brick')) return 1;
  if (name === 'stone' || name === 'marble') return 2;
  if (name === 'plaster') return 3;
  if (['vermilion', 'teal', 'qing', 'wood'].includes(name)) return 4;
  if (name === 'tile' || name === 'ridge') return 5;
  if (name === 'earth') return 6;
  if (name === 'trunk') return 7;
  return 0;
}
