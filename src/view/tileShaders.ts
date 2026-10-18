import { SHADOW_GLSL } from './surfaceShading';

// 3D 地块视图着色器。局部坐标：x 向东、y 向上、z 向南（世界坐标 y 向北 = -z）。

const FOG = /* glsl */ `
uniform vec3 uFogColor;
uniform vec2 uFogRange;
vec3 applyFog(vec3 c, float dist) {
  return mix(c, uFogColor, smoothstep(uFogRange.x, uFogRange.y, dist) * 0.85);
}`;

// 背景：纸色天空，上浅下深，边缘暗角
export const SKY_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform vec2 uCanvas;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uCanvas;
  vec3 top = vec3(0.945, 0.918, 0.851);
  vec3 bottom = vec3(0.835, 0.812, 0.757);
  vec3 c = mix(bottom, top, smoothstep(0.0, 1.0, uv.y));
  float vig = smoothstep(0.95, 0.35, length((uv - 0.5) * vec2(1.2, 1.0)));
  outColor = vec4(c * mix(0.88, 1.0, vig), 1.0);
}`;

export const PRISM_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aKind;   // 0 = 陆地顶面，1 = 水面，2 = 侧面
layout(location = 3) in float aFocus;  // 1 = 中心格，0 = 邻格
uniform mat4 uViewProj;
out vec3 vPos;
out vec3 vNormal;
flat out int vKind;
out float vFocus;
void main() {
  vPos = aPos;
  vNormal = aNormal;
  vKind = int(aKind + 0.5);
  vFocus = aFocus;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const PRISM_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNormal;
flat in int vKind;
in float vFocus;
uniform sampler2D uMap;
uniform vec2 uImageSize;
uniform mat3 uWorldToImg;
uniform vec2 uCenterWorld;
uniform vec3 uEye;
uniform vec3 uSun;
uniform float uTime;
uniform float uBottom;
${FOG}
${SHADOW_GLSL}
out vec4 outColor;

vec3 sampleMap(vec2 local) {
  vec2 world = uCenterWorld + vec2(local.x, -local.y);
  vec3 i = uWorldToImg * vec3(world, 1.0);
  return texture(uMap, (i.xy / i.z) / uImageSize).rgb;
}

void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, uSun), 0.0);
  vec3 col;
  if (vKind == 2) {
    // 侧面：土层，上浅下深，带细微分层
    float t = clamp((vPos.y - uBottom) / (-uBottom + 40.0), 0.0, 1.0);
    col = mix(vec3(0.36, 0.27, 0.19), vec3(0.62, 0.50, 0.36), t);
    col *= 0.94 + 0.06 * sin(vPos.y * 0.35);
    col *= 0.55 + 0.5 * diff;
  } else {
    vec2 p = vPos.xz;
    if (vKind == 1) {
      vec2 w = vec2(sin(p.y * 0.06 + uTime * 1.3), cos(p.x * 0.05 - uTime * 1.1)) * 1.8;
      col = sampleMap(p + w);
      col = mix(col, vec3(0.50, 0.62, 0.66), 0.18);
      float glint = pow(max(0.0, sin(p.x * 0.09 + p.y * 0.05 + uTime * 2.0)), 24.0);
      col += glint * 0.08;
    } else {
      col = sampleMap(p);
    }
    col *= 0.92 + 0.12 * diff;
    col *= mix(0.62, 1.0, shadowAt(vPos, n));      // 建筑投在地面上的影子
    // 邻格略暗，突出中心格
    col *= mix(0.86, 1.0, vFocus);
  }
  col = applyFog(col, distance(vPos, uEye));
  outColor = vec4(col, 1.0);
}`;

// 立牌：概念图，绕竖轴朝向相机，底边贴地
export const BILLBOARD_VS = /* glsl */ `#version 300 es
uniform mat4 uViewProj;
uniform vec3 uBase;
uniform vec2 uSize;
uniform vec3 uRight;
uniform float uLift;
out vec2 vUv;
out vec3 vPos;
void main() {
  vec2 c = vec2(gl_VertexID & 1, (gl_VertexID >> 1) & 1);
  vUv = vec2(c.x, 1.0 - c.y);
  vec3 p = uBase + uRight * (c.x - 0.5) * uSize.x + vec3(0.0, c.y * uSize.y + uLift, 0.0);
  vPos = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const BILLBOARD_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUv;
in vec3 vPos;
uniform sampler2D uTex;
uniform vec3 uEye;
uniform float uOpacity;
uniform float uShade;
uniform float uPremul;   // 1 = 混合绘制（预乘输出），0 = alpha-to-coverage
${FOG}
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUv);
  if (c.a < 0.04) discard;
  vec3 rgb = c.rgb / max(c.a, 1e-3);
  // 底部轻微压暗，模拟接地
  rgb *= mix(0.78, 1.0, smoothstep(0.0, 0.25, 1.0 - vUv.y)) * uShade;
  rgb = applyFog(rgb, distance(vPos, uEye));
  float a = c.a * uOpacity;
  outColor = vec4(rgb * mix(1.0, a, uPremul), a);
}`;

// 接地阴影：贴在格面上的椭圆
export const SHADOW_VS = /* glsl */ `#version 300 es
uniform mat4 uViewProj;
uniform vec3 uBase;
uniform vec2 uRadius;
out vec2 vP;
void main() {
  vec2 c = vec2(gl_VertexID & 1, (gl_VertexID >> 1) & 1) * 2.0 - 1.0;
  vP = c;
  gl_Position = uViewProj * vec4(uBase + vec3(c.x * uRadius.x, 0.4, c.y * uRadius.y), 1.0);
}`;

export const SHADOW_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vP;
out vec4 outColor;
void main() {
  float a = (1.0 - smoothstep(0.35, 1.0, length(vP))) * 0.32;
  outColor = vec4(0.12, 0.09, 0.06, 1.0) * a;
}`;
