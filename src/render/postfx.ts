// 离屏渲染目标：多重采样颜色 + 深度，解析到普通贴图供后处理使用。

export class SceneTarget {
  private msaaFbo: WebGLFramebuffer;
  private colorRb: WebGLRenderbuffer;
  private depthRb: WebGLRenderbuffer;
  private resolveFbo: WebGLFramebuffer;
  readonly texture: WebGLTexture;
  private w = 0;
  private h = 0;
  private samples: number;

  constructor(private gl: WebGL2RenderingContext) {
    this.msaaFbo = gl.createFramebuffer()!;
    this.colorRb = gl.createRenderbuffer()!;
    this.depthRb = gl.createRenderbuffer()!;
    this.resolveFbo = gl.createFramebuffer()!;
    this.texture = gl.createTexture()!;
    // 高像素密度屏（DPR ≥ 2）上像素本身已很细，2 倍多重采样就够，省下近一半填充开销
    this.samples = Math.min(window.devicePixelRatio >= 2 ? 2 : 4, gl.getParameter(gl.MAX_SAMPLES) as number);
  }

  /** 尺寸变化时重建附件。 */
  ensure(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w;
    this.h = h;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorRb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  begin(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.msaaFbo);
  }

  /** 解析多重采样到贴图，并切回默认帧缓冲。 */
  resolve(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
