import type { CursorImage } from "../formats/pe";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./framebuffer";

const WAIT_WIDTH = 16;
const WAIT_HEIGHT = 22;

export interface PointerHandlers {
  move: (x: number, y: number) => void;
  click: (x: number, y: number) => void;
  relative: (dx: number, dy: number) => void;
  lockLost: () => void;
}

interface DrawnCursor {
  image: HTMLCanvasElement;
  hotspotX: number;
  hotspotY: number;
}

function cursorCanvas(cursor: CursorImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const source = new ImageData(cursor.rgba, cursor.width, cursor.height);

  canvas.width = cursor.width;
  canvas.height = cursor.height;
  context?.putImageData(source, 0, 0);

  return canvas;
}

function waitCursor(): DrawnCursor {
  const image = document.createElement("canvas");
  const context = image.getContext("2d");

  image.width = WAIT_WIDTH;
  image.height = WAIT_HEIGHT;

  if (context) {
    context.fillStyle = "#fff";
    context.strokeStyle = "#000";
    context.beginPath();
    context.moveTo(1, 1);
    context.lineTo(WAIT_WIDTH - 1, 1);
    context.lineTo(WAIT_WIDTH / 2, WAIT_HEIGHT / 2);
    context.lineTo(WAIT_WIDTH - 1, WAIT_HEIGHT - 1);
    context.lineTo(1, WAIT_HEIGHT - 1);
    context.lineTo(WAIT_WIDTH / 2, WAIT_HEIGHT / 2);
    context.closePath();
    context.fill();
    context.stroke();
  }

  return { image, hotspotX: WAIT_WIDTH / 2, hotspotY: WAIT_HEIGHT / 2 };
}

function clamp(value: number, limit: number): number {
  return Math.max(0, Math.min(limit - 1, value));
}

export class Input {
  private readonly canvas: HTMLCanvasElement;
  private readonly handlers: PointerHandlers;
  private readonly cursors = new Map<string, DrawnCursor>();
  private cursorName = "arrow";
  private virtualX = SCREEN_WIDTH / 2;
  private virtualY = SCREEN_HEIGHT / 2;
  private relativeOnly = false;

  constructor(canvas: HTMLCanvasElement, handlers: PointerHandlers) {
    this.canvas = canvas;
    this.handlers = handlers;

    canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    canvas.addEventListener("pointerdown", () => this.lock());
    canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    document.addEventListener("pointerlockchange", () => this.onLockChange());
  }

  lock(): void {
    if (this.isLocked()) {
      return;
    }

    this.canvas.requestPointerLock()?.catch(() => undefined);
  }

  isLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  setRelativeOnly(relativeOnly: boolean): void {
    this.relativeOnly = relativeOnly;
  }

  warp(x: number, y: number): void {
    this.virtualX = clamp(x, SCREEN_WIDTH);
    this.virtualY = clamp(y, SCREEN_HEIGHT);
  }

  registerCursor(name: string, cursor: CursorImage): void {
    const image = cursorCanvas(cursor);
    const hotspotX = cursor.hotspotX;
    const hotspotY = cursor.hotspotY;

    this.cursors.set(name, { image, hotspotX, hotspotY });
    this.cursors.set("wait", waitCursor());
  }

  setCursor(name: string): void {
    this.cursorName = name;
    this.applyCssCursor();
  }

  drawCursor(): void {
    const context = this.canvas.getContext("2d");
    const cursor = this.cursors.get(this.cursorName);

    if (!this.isLocked() || !context || !cursor) {
      return;
    }

    const left = Math.round(this.virtualX - cursor.hotspotX);
    const top = Math.round(this.virtualY - cursor.hotspotY);

    context.drawImage(cursor.image, left, top);
  }

  private applyCssCursor(): void {
    if (this.isLocked()) {
      this.canvas.style.cursor = "none";
      return;
    }

    const cursor = this.cursors.get(this.cursorName);
    const css = cursor ? this.cssFor(cursor) : this.cursorName;

    this.canvas.style.cursor = css;
  }

  private cssFor(cursor: DrawnCursor): string {
    const url = cursor.image.toDataURL("image/png");

    return `url(${url}) ${cursor.hotspotX} ${cursor.hotspotY}, default`;
  }

  private onLockChange(): void {
    this.applyCssCursor();

    if (!this.isLocked()) {
      this.handlers.lockLost();
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const [dx, dy] = this.toScreenDelta(event);

    this.handlers.relative(dx, dy);

    const followsMotion = this.isLocked() || this.relativeOnly;

    if (followsMotion) {
      this.warp(this.virtualX + dx, this.virtualY + dy);
    } else {
      const [x, y] = this.toScreen(event);

      this.warp(x, y);
    }

    this.handlers.move(Math.floor(this.virtualX), Math.floor(this.virtualY));
  }

  private onPointerUp(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    const followsMotion = this.isLocked() || this.relativeOnly;

    if (!followsMotion) {
      const [x, y] = this.toScreen(event);

      this.warp(x, y);
    }

    this.handlers.click(Math.floor(this.virtualX), Math.floor(this.virtualY));
  }

  private toScreenDelta(event: PointerEvent): [number, number] {
    const dx = event.movementX;
    const dy = event.movementY;

    return [dx, dy];
  }

  private toScreen(event: PointerEvent): [number, number] {
    const bounds = this.canvas.getBoundingClientRect();
    const relativeX = (event.clientX - bounds.left) / bounds.width;
    const relativeY = (event.clientY - bounds.top) / bounds.height;
    const x = Math.floor(relativeX * SCREEN_WIDTH);
    const y = Math.floor(relativeY * SCREEN_HEIGHT);

    return [x, y];
  }
}
