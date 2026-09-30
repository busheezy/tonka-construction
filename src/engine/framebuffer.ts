import { TRANSPARENT_INDEX, type IndexedImage } from "../formats/module";

export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;
const FADE_LEVELS = 256;
const FADE_STEP = 8;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

interface Span {
  sourceStart: number;
  targetStart: number;
  length: number;
}

function clipSpan(position: number, size: number, limit: number): Span | undefined {
  const sourceStart = Math.max(0, -position);
  const targetStart = Math.max(0, position);
  const targetEnd = Math.min(limit, position + size);
  const length = targetEnd - targetStart;

  if (length <= 0) {
    return undefined;
  }

  return { sourceStart, targetStart, length };
}

export interface OverlayText {
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
  align?: CanvasTextAlign;
}

export class Framebuffer {
  readonly overlays = new Map<string, OverlayText>();
  readonly pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  private readonly colors = new Uint32Array(256);
  private readonly baseColors = new Uint8Array(256 * 3);
  private readonly context: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private readonly rgba: Uint32Array;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas 2D is not available");
    }

    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    this.context = context;
    this.imageData = context.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    this.rgba = new Uint32Array(this.imageData.data.buffer);
  }

  setPalette(palette: Uint8Array): void {
    for (let index = 0; index < 256; index += 1) {
      this.setColor(index, palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2]);
    }
  }

  setColor(index: number, red: number, green: number, blue: number): void {
    this.baseColors[index * 3] = red;
    this.baseColors[index * 3 + 1] = green;
    this.baseColors[index * 3 + 2] = blue;
    this.writeColor(index, red, green, blue);
  }

  async fadeOut(): Promise<void> {
    for (let level = FADE_LEVELS - FADE_STEP; level >= 0; level -= FADE_STEP) {
      this.applyFadeLevel(level);
      this.present();
      await nextFrame();
    }

    this.fill(0);
  }

  private applyFadeLevel(level: number): void {
    for (let index = 0; index < 256; index += 1) {
      const red = (this.baseColors[index * 3] * level) >> 8;
      const green = (this.baseColors[index * 3 + 1] * level) >> 8;
      const blue = (this.baseColors[index * 3 + 2] * level) >> 8;

      this.writeColor(index, red, green, blue);
    }
  }

  private writeColor(index: number, red: number, green: number, blue: number): void {
    const alpha = 0xff << 24;

    this.colors[index] = (alpha | (blue << 16) | (green << 8) | red) >>> 0;
  }

  drawOpaque(image: IndexedImage, sourceX: number, sourceY: number): void {
    const rows = Math.min(SCREEN_HEIGHT, image.height - sourceY);
    const columns = Math.min(SCREEN_WIDTH, image.width - sourceX);

    for (let row = 0; row < rows; row += 1) {
      const start = (row + sourceY) * image.width + sourceX;
      const line = image.pixels.subarray(start, start + columns);

      this.pixels.set(line, row * SCREEN_WIDTH);
    }
  }

  blitOpaque(
    image: IndexedImage,
    sourceX: number,
    sourceY: number,
    width: number,
    height: number,
    targetX: number,
    targetY: number,
  ): void {
    for (let row = 0; row < height; row += 1) {
      const start = (sourceY + row) * image.width + sourceX;
      const line = image.pixels.subarray(start, start + width);

      this.pixels.set(line, (targetY + row) * SCREEN_WIDTH + targetX);
    }
  }

  drawTransparent(image: IndexedImage, left: number, top: number): void {
    const horizontal = clipSpan(left, image.width, SCREEN_WIDTH);
    const vertical = clipSpan(top, image.height, SCREEN_HEIGHT);

    if (!horizontal || !vertical) {
      return;
    }

    for (let row = 0; row < vertical.length; row += 1) {
      const sourceRow = (vertical.sourceStart + row) * image.width + horizontal.sourceStart;
      const targetRow = (vertical.targetStart + row) * SCREEN_WIDTH + horizontal.targetStart;

      this.copyRow(image.pixels, sourceRow, targetRow, horizontal.length);
    }
  }

  toDataUrl(): string {
    return this.context.canvas.toDataURL("image/png");
  }

  fill(index: number): void {
    this.pixels.fill(index);
  }

  present(): void {
    const count = this.pixels.length;

    for (let index = 0; index < count; index += 1) {
      this.rgba[index] = this.colors[this.pixels[index]];
    }

    this.context.putImageData(this.imageData, 0, 0);
    this.drawOverlays();
  }

  private drawOverlays(): void {
    for (const overlay of this.overlays.values()) {
      this.context.font = overlay.font;
      this.context.fillStyle = overlay.color;
      this.context.textBaseline = "top";
      this.context.textAlign = overlay.align ?? "left";
      this.context.fillText(overlay.text, overlay.x, overlay.y);
    }
  }

  private copyRow(
    source: Uint8Array,
    sourceStart: number,
    targetStart: number,
    length: number,
  ): void {
    for (let offset = 0; offset < length; offset += 1) {
      const value = source[sourceStart + offset];

      if (value !== TRANSPARENT_INDEX) {
        this.pixels[targetStart + offset] = value;
      }
    }
  }
}
