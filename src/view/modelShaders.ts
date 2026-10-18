// glb 模型的卡通着色、描边，以及移轴后处理。

import { MATERIAL_GLSL, SHADOW_GLSL } from './surfaceShading';

export const TOON_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aColor;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
out vec3 vPos;
out vec3 vNormal;
out vec2 vUv;
out vec4 vColor;
out vec3 vObj;      // 模型自身坐标（米），程序化纹理用
out vec3 vObjN;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vPos = w.xyz;
  vObj = aPos;
  vObjN = aNormal;
  vNormal = uNormalMat * aNormal;
  vUv = aUv;
  vColor = aColor;
  gl_Position = uViewProj * w;
}`;

export const TOON_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNormal;
in vec2 vUv;
in vec4 vColor;
in vec3 vObj;
in vec3 vObjN;
uniform int uMatKind;
uniform sampler2D uTex;
uniform bool uHasTex;
uniform vec4 uColor;
uniform vec3 uSun;
uniform vec3 uEye;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
out vec4 outColor;
${SHADOW_GLSL}
${MATERIAL_GLSL}

void main() {
  vec4 base = uColor * vColor;
  if (uHasTex) base *= texture(uTex, vUv);
  if (base.a < 0.4) discard;
  base.rgb *= surfaceDetail(uMatKind, vObj, normalize(vObjN));
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vPos);
  // 背面朝向相机时翻转法线（图生 3D 的网格常有绕序问题）
  if (dot(n, v) < 0.0) n = -n;
  // 阴影：落在阴影里的面压到最暗的一档
  float sh = shadowAt(vPos, n);
  float l = min(dot(n, uSun), mix(-0.25, 1.0, sh));
  // 三阶明暗：暗部偏冷，亮部偏暖
  float band = 0.55 + 0.25 * smoothstep(-0.05, 0.05, l) + 0.2 * smoothstep(0.42, 0.5, l);
  vec3 shadowTint = vec3(0.70, 0.74, 0.86);
  vec3 c = base.rgb * mix(shadowTint * 0.64, vec3(0.97, 0.94, 0.88), band);
  // 轻微压低饱和度，向纸本色板靠拢
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(g) * vec3(1.02, 0.98, 0.9), 0.15);
  // 边缘暖光
  c += vec3(1.0, 0.9, 0.7) * pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.12;
  c = mix(c, uFogColor, smoothstep(uFogRange.x, uFogRange.y, distance(vPos, uEye)) * 0.85);
  outColor = vec4(c, 1.0);
}`;

// 描边：沿法线外扩、只画背面（inverted hull），宽度按到相机距离换算成固定像素
export const OUTLINE_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 4) in vec3 aOutlineNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform vec3 uEye;
uniform float uOutlineK;   // 每米距离对应的外扩量（已含像素宽度）
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vec3 n = normalize(uNormalMat * aOutlineNormal);
  w.xyz += n * uOutlineK * distance(w.xyz, uEye);
  gl_Position = uViewProj * w;
}`;

export const OUTLINE_FS = /* glsl */ `#version 300 es
precision mediump float;
out vec4 outColor;
void main() { outColor = vec4(0.18, 0.13, 0.09, 1.0); }`;

// 移轴：画面上下按距离焦带的远近做圆盘模糊
export const TILTSHIFT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uCanvas;
uniform float uFocusY;     // 焦带中心（0..1，自下而上）
uniform float uFocusHalf;  // 焦带半高
uniform float uMaxBlur;    // 最大模糊半径（画布像素）
out vec4 outColor;
const vec2 DISK[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);
void main() {
  vec2 uv = gl_FragCoord.xy / uCanvas;
  float d = max(0.0, abs(uv.y - uFocusY) - uFocusHalf);
  float r = uMaxBlur * smoothstep(0.0, 0.35, d);
  vec4 c = texture(uScene, uv);
  if (r > 0.5) {
    vec4 acc = c;
    for (int i = 0; i < 12; i++) acc += texture(uScene, uv + DISK[i] * r / uCanvas);
    c = acc / 13.0;
  }
  outColor = c;
}`;

// 阴影深度：只写深度
export const DEPTH_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;

export const DEPTH_FS = /* glsl */ `#version 300 es
precision mediump float;
void main() {}`;
