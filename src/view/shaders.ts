// 地图视图着色器。

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// 底图 + 六边形网格。
// 每个片元：屏幕 → 底图像素 → (单应性) → 世界坐标 → 六边形轴坐标。
export const MAP_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uMap;
uniform vec2 uImageSize;
uniform vec2 uCenter;
uniform float uZoom;
uniform vec2 uCanvas;
uniform mat3 uImgToWorld;
uniform float uHexSize;
uniform highp sampler2D uHexData;
uniform ivec2 uHexMin;
uniform ivec2 uHexDim;
uniform ivec2 uHover;
uniform ivec2 uSelected;
uniform float uTime;
uniform float uGridAlpha;
uniform float uPx;   // 一个 CSS 像素对应的画布像素数
uniform float uOverlay;          // 地形叠加强度（标定工具用），0 = 关闭
uniform vec3 uPalette[9];        // 地形叠加色，下标 = 地形索引

out vec4 outColor;

const vec3 PAPER = vec3(0.925, 0.886, 0.792);
const vec3 INK = vec3(0.22, 0.17, 0.12);
const vec3 GOLD = vec3(0.86, 0.62, 0.22);
const float SQRT3 = 1.7320508;

ivec2 hexRound(vec2 f) {
  vec3 c = vec3(f.x, f.y, -f.x - f.y);
  vec3 r = floor(c + 0.5);
  vec3 d = abs(r - c);
  if (d.x > d.y && d.x > d.z) r.x = -r.y - r.z;
  else if (d.y > d.z) r.y = -r.x - r.z;
  return ivec2(r.xy);
}

ivec2 hexInfo(ivec2 h) {
  ivec2 t = h - uHexMin;
  if (any(lessThan(t, ivec2(0))) || any(greaterThanEqual(t, uHexDim))) return ivec2(0);
  vec4 d = texelFetch(uHexData, t, 0);
  return ivec2(d.rg * 255.0 + 0.5);   // x = 标志位，y = 地形索引
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 img = uCenter + (frag - uCanvas * 0.5) / uZoom;

  // 底图取色，边缘淡出到纸色
  vec3 col = PAPER;
  if (all(greaterThanEqual(img, vec2(0.0))) && all(lessThanEqual(img, uImageSize))) {
    col = texture(uMap, img / uImageSize).rgb;
    vec2 e = min(img, uImageSize - img);
    float fade = smoothstep(0.0, 36.0, min(e.x, e.y));
    col = mix(PAPER, col, fade);
  }

  vec3 w = uImgToWorld * vec3(img, 1.0);
  if (w.z > 0.0) {
    vec2 p = w.xy / w.z;
    vec2 f = vec2((SQRT3 / 3.0 * p.x - p.y / 3.0), (2.0 / 3.0) * p.y) / uHexSize;
    ivec2 h = hexRound(f);
    vec2 c = vec2(uHexSize * SQRT3 * (float(h.x) + float(h.y) * 0.5), uHexSize * 1.5 * float(h.y));
    vec2 l = p - c;
    float inr = uHexSize * SQRT3 * 0.5;
    float m = max(abs(l.x), max(abs(dot(l, vec2(0.5, 0.8660254))), abs(dot(l, vec2(-0.5, 0.8660254)))));
    float d = inr - m;                    // 到格边的距离（米）
    float fw = max(fwidth(d), 1e-4);      // 一个画布像素对应的米数
    float dpx = d / fw;                   // 到格边的距离（画布像素）

    ivec2 info = hexInfo(h);
    int flags = info.x;
    bool valid = (flags & 1) != 0;
    if (uOverlay > 0.0 && info.y > 0) {
      float inner = smoothstep(0.5 * uPx, 2.0 * uPx, dpx);
      col = mix(col, uPalette[info.y], uOverlay * inner);
    }
    bool site = (flags & 2) != 0;
    bool visited = (flags & 4) != 0;
    bool hover = h == uHover;
    bool selected = h == uSelected;

    if (valid) {
      float line = 1.0 - smoothstep(0.5 * uPx, 1.3 * uPx, dpx);
      col = mix(col, INK, line * uGridAlpha);
      if (site) {
        float inner = 1.0 - smoothstep(1.5 * uPx, 5.0 * uPx, dpx);
        col = mix(col, visited ? INK : GOLD, inner * (visited ? 0.12 : 0.22));
      }
    }
    if ((hover || selected) && valid) {
      float pulse = selected ? 0.5 + 0.5 * sin(uTime * 4.0) : 1.0;
      col = mix(col, vec3(1.0, 0.97, 0.88), (selected ? 0.16 : 0.12) * pulse);
      float edge = 1.0 - smoothstep(1.2 * uPx, 2.6 * uPx, dpx);
      col = mix(col, GOLD, edge * 0.9);
    }
  }

  // 视口暗角
  vec2 uv = gl_FragCoord.xy / uCanvas;
  float vig = smoothstep(0.85, 0.35, length(uv - 0.5));
  col *= mix(0.86, 1.0, vig);

  outColor = vec4(col, 1.0);
}`;

// 地点徽记：每个徽记一个四边形，大小固定为屏幕像素，锚在格中心上方。
export const MARKER_VS = /* glsl */ `#version 300 es
uniform vec2 uCenter;
uniform float uZoom;
uniform vec2 uCanvas;
uniform vec2 uPos;      // 底图像素
uniform float uSize;    // 画布像素
uniform float uLift;    // 画布像素，向上偏移
out vec2 vUv;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, (gl_VertexID >> 1) & 1);
  vUv = vec2(corner.x, corner.y);
  vec2 s = (uPos - uCenter) * uZoom + uCanvas * 0.5;
  s += (corner - vec2(0.5, 1.0)) * uSize - vec2(0.0, uLift);
  vec2 clip = s / uCanvas * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const MARKER_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uAlpha;
uniform float uDim;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUv);
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(c.rgb, vec3(g) * 0.9, uDim);
  outColor = c * uAlpha;
}`;
