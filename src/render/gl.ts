// WebGL2 最小工具集：上下文、着色器、贴图。

export function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: false });
  if (!gl) throw new Error('当前浏览器不支持 WebGL2，或硬件加速已关闭。请使用较新版本的 Chrome、Edge、Safari 或 Firefox，并确认浏览器设置里开启了「使用硬件加速」。');
  return gl;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`着色器编译失败：\n${log}`);
  }
  return sh;
}

export interface Program {
  handle: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`着色器链接失败：\n${gl.getProgramInfoLog(p)}`);
  const u: Program['u'] = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i)!.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  return { handle: p, u };
}

export interface Texture {
  handle: WebGLTexture;
  width: number;
  height: number;
}

/** 解码图片：优先 fetch + createImageBitmap（与 DOM 无关、在后台线程解码，预乘 alpha 在解码时完成）；
 *  不支持时退回 <img>。WebKit 里同一张图片若正被 DOM 动画使用，用 <img> 上传偶尔会报「bad image data」，
 *  所以默认走 ImageBitmap。 */
async function decodeImage(url: string): Promise<{ source: TexImageSource; width: number; height: number; premultiplied: boolean }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
      return { source: bmp, width: bmp.width, height: bmp.height, premultiplied: true };
    } catch {
      // 退回下面的 <img> 路径
    }
  }
  const img = new Image();
  img.src = url;
  await img.decode();
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, premultiplied: false };
}

export async function loadTexture(gl: WebGL2RenderingContext, url: string): Promise<Texture> {
  const img = await decodeImage(url);
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  // ImageBitmap 已经预乘过；<img> 需要上传时预乘
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !img.premultiplied);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img.source);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  if (img.source instanceof ImageBitmap) img.source.close();
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return { handle: t, width: img.width, height: img.height };
}

/** RGBA8 数据贴图，最近邻采样，用 texelFetch 读取。 */
export function createDataTexture(gl: WebGL2RenderingContext, w: number, h: number, data: Uint8Array): Texture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return { handle: t, width: w, height: h };
}

export function updateDataTexture(gl: WebGL2RenderingContext, tex: Texture, data: Uint8Array): void {
  gl.bindTexture(gl.TEXTURE_2D, tex.handle);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tex.width, tex.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

let dprCap = 2;
/** 画质自动降档时调用：限制画布的最大像素密度。 */
export function setDprCap(cap: number): void {
  dprCap = cap;
}
export const getDprCap = () => dprCap;

/** 根据 CSS 尺寸和 DPR 调整画布像素尺寸；返回是否发生变化。 */
export function resizeCanvas(canvas: HTMLCanvasElement, maxDpr = dprCap): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}
