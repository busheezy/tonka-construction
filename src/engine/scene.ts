import {
  decodeChunkImage,
  decodeFrame,
  readStreamChunks,
  TRANSPARENT_INDEX,
  type GameModule,
  type IndexedImage,
  type ObjectDef,
  type StreamChunk,
} from "../formats/module";
import { Framebuffer, SCREEN_WIDTH } from "./framebuffer";

const HUD_TYPE = 3;
const SORTED_TYPE = 1;
const LAYER_TYPES = [0, 1, 2, 3];

export interface ObjectSnapshot {
  type: number;
  visible: boolean;
  grabbable: boolean;
  active: boolean;
  x: number;
  y: number;
  frame: number;
  chunkIndex: number;
  looping: boolean;
  finished: boolean;
  heading: number;
  loadSet: number;
  toolFrame: number;
  loadState: number;
  link: number;
  carrier: number;
  step: number;
}

export interface SceneSnapshot {
  scrollX: number;
  objects: ObjectSnapshot[];
}

export interface SceneObject {
  def: ObjectDef;
  type: number;
  visible: boolean;
  grabbable: boolean;
  active: boolean;
  x: number;
  y: number;
  frame: number;
  image: IndexedImage | undefined;
  left: number;
  top: number;
  chunks: StreamChunk[] | undefined;
  chunkIndex: number;
  playing: boolean;
  looping: boolean;
  keepLastFrame: boolean;
  interruptible: boolean;
  finished: boolean;
  heading: number;
  loadSet: number;
  toolFrame: number;
  loadState: number;
  link: number;
  carrier: number;
  step: number;
  moduleLink: number;
}

function createObject(module: GameModule, def: ObjectDef): SceneObject {
  const raw = def.raw;
  const visible = raw.getUint32(0x10, true) !== 0;
  const grabbable = raw.getUint32(0x14, true) !== 0;
  const active = raw.getUint32(0x18, true) !== 0;
  const interruptible = raw.getUint32(0x58, true) !== 0;
  const looping = raw.getUint32(0x5c, true) !== 0;
  const keepLastFrame = raw.getUint32(0x60, true) !== 0;
  const link = raw.getUint16(0x74, true);
  const chunks = def.streamed ? readStreamChunks(module, def) : undefined;

  return {
    def,
    type: def.type,
    visible,
    grabbable,
    active,
    moduleLink: link,
    x: def.x,
    y: def.y,
    frame: def.initialFrame,
    image: undefined,
    left: def.x,
    top: def.y,
    chunks,
    chunkIndex: 0,
    playing: false,
    looping,
    keepLastFrame,
    interruptible,
    finished: false,
    heading: def.headings >= 12 ? def.initialFrame : 0,
    loadSet: 0,
    toolFrame: 0,
    loadState: 0,
    link: -1,
    carrier: -1,
    step: 0,
  };
}

function bottomEdge(object: SceneObject): number {
  const height = object.image?.height ?? 0;

  return object.top + height;
}

export class Scene {
  readonly module: GameModule;
  readonly filePalette: Uint8Array;
  readonly objects: SceneObject[];
  drawOrder: number[] = [];
  scrollX = 0;
  heldObject: number | undefined;
  pan: IndexedImage | undefined;
  panPos = 0;

  constructor(module: GameModule) {
    this.module = module;
    this.filePalette = module.palette.slice();
    this.objects = module.objects.map((def) => createObject(module, def));
    this.scrollX = Math.min(module.header.scrollBase, this.maxScroll);

    for (const object of this.objects) {
      this.initialisePose(object);
    }

    this.buildDrawOrder();
  }

  private initialisePose(object: SceneObject): void {
    const index = object.def.index;

    if (this.isVehicle(index)) {
      this.setPose(index, object.heading, 0, 0);
      return;
    }

    this.refreshStaticImage(object);
  }

  snapshot(): SceneSnapshot {
    const objects = this.objects.map((object) => ({
      type: object.type,
      visible: object.visible,
      grabbable: object.grabbable,
      active: object.active,
      x: object.x,
      y: object.y,
      frame: object.frame,
      chunkIndex: object.chunkIndex,
      looping: object.looping,
      finished: object.finished,
      heading: object.heading,
      loadSet: object.loadSet,
      toolFrame: object.toolFrame,
      loadState: object.loadState,
      link: object.link,
      carrier: object.carrier,
      step: object.step,
    }));

    return { scrollX: this.scrollX, objects };
  }

  restore(snapshot: SceneSnapshot): void {
    this.scrollX = snapshot.scrollX;

    snapshot.objects.forEach((saved, index) => {
      const object = this.objects[index];

      if (!object) {
        return;
      }

      Object.assign(object, saved);
      this.restoreImage(index);
    });

    this.buildDrawOrder();
  }

  private restoreImage(index: number): void {
    const object = this.objects[index];

    if (!object.def.streamed) {
      this.refreshStaticImage(object);
      return;
    }

    if (object.visible) {
      this.showChunk(index, object.chunkIndex);
    }
  }

  get maxScroll(): number {
    return Math.max(0, this.module.background.width - SCREEN_WIDTH);
  }

  buildDrawOrder(): void {
    const indices = this.objects.map((_, index) => index);
    const grouped = LAYER_TYPES.map((type) =>
      indices.filter((index) => this.objects[index].type === type),
    );

    this.drawOrder = grouped.flat();
  }

  scrollBy(delta: number): boolean {
    const target = this.scrollX + delta;
    const canScrollRight = delta > 0 && target < this.maxScroll;
    const canScrollLeft = delta < 0 && target >= 0;

    if (!canScrollRight && !canScrollLeft) {
      return false;
    }

    this.scrollX = target;

    return true;
  }

  setVisible(index: number, visible: boolean): void {
    const object = this.objects[index];
    const needsStreamImage = visible && object.def.streamed && !object.image;

    object.visible = visible;

    if (needsStreamImage) {
      this.showChunk(index, object.chunkIndex);
    }
  }

  setFrame(index: number, frame: number): void {
    const object = this.objects[index];

    object.frame = frame;

    if (object.def.streamed) {
      this.showChunk(index, frame);
      return;
    }

    this.refreshStaticImage(object);
  }

  setPose(index: number, heading: number, loadSet: number, toolFrame: number): void {
    const object = this.objects[index];
    const sets = Math.max(1, object.def.sets);
    const tools = Math.max(1, object.def.framesPerSet);
    const frame = heading * sets * tools + loadSet * tools + toolFrame;

    object.heading = heading;
    object.loadSet = loadSet;
    object.toolFrame = toolFrame;
    this.setFrame(index, frame);
  }

  chain(start: number, visited: number[] = []): number[] {
    const isEnd = start < 0 || visited.includes(start) || !this.objects[start];

    if (isEnd) {
      return visited;
    }

    const next = this.objects[start].link;

    return this.chain(next, [...visited, start]);
  }

  isVehicle(index: number): boolean {
    return this.objects[index].def.headings >= 12;
  }

  moveTo(index: number, x: number, y: number): void {
    const object = this.objects[index];

    object.x = x;
    object.y = y;
    this.refreshStaticImage(object);
  }

  showChunk(index: number, chunkIndex: number): StreamChunk | undefined {
    const object = this.objects[index];
    const chunk = object.chunks?.[chunkIndex];

    object.chunkIndex = chunkIndex;

    if (!chunk) {
      return undefined;
    }

    const image = decodeChunkImage(chunk);

    if (image) {
      object.image = image;
      object.left = object.x + chunk.offsetX;
      object.top = object.y + chunk.offsetY;
    }

    return chunk;
  }

  resetStream(index: number): void {
    const object = this.objects[index];

    object.chunkIndex = 0;
    object.x = object.def.x;
    object.y = object.def.y;

    if (object.def.streamed) {
      object.image = undefined;
      return;
    }

    object.frame = 0;
    this.refreshStaticImage(object);
  }

  hitTest(worldX: number, worldY: number): number | undefined {
    for (let order = this.drawOrder.length - 1; order >= 0; order -= 1) {
      const index = this.drawOrder[order];
      const isCandidate = index !== this.heldObject;
      const isHit = isCandidate && this.isOpaqueAt(this.objects[index], worldX, worldY);

      if (isHit) {
        return index;
      }
    }

    return undefined;
  }

  render(framebuffer: Framebuffer): void {
    this.sortMiddleLayer();
    framebuffer.drawOpaque(this.module.background, this.scrollX, 0);
    this.drawPan(framebuffer);

    for (const index of this.drawOrder) {
      this.drawObject(framebuffer, this.objects[index]);
    }
  }

  imageForPose(index: number, heading: number, loadSet: number, toolFrame: number): IndexedImage {
    const object = this.objects[index];
    const sets = Math.max(1, object.def.sets);
    const tools = Math.max(1, object.def.framesPerSet);
    const frame = heading * sets * tools + loadSet * tools + toolFrame;

    return decodeFrame(this.module, object.def, frame);
  }

  collide(
    mover: number,
    x: number,
    y: number,
    image: IndexedImage,
    moduleNumber: number,
  ): number | undefined {
    const moverObject = this.objects[mover];
    const left = x - (image.width >> 1);
    const top = y - (image.height >> 1);
    const topmostFirst = [...this.drawOrder].reverse();

    return topmostFirst.find((candidate) => {
      const isEligible = this.isCollisionCandidate(mover, candidate);

      if (!isEligible) {
        return false;
      }

      const passesGate =
        this.isHardPair(mover, candidate) ||
        this.depthGate(moverObject, candidate, y, moduleNumber);

      return passesGate && this.pixelsOverlap(image, left, top, this.objects[candidate]);
    });
  }

  flag(index: number, offset: number): boolean {
    return this.objects[index].def.raw.getUint32(offset, true) !== 0;
  }

  private isCollisionCandidate(mover: number, candidate: number): boolean {
    const object = this.objects[candidate];
    const isCollidable = this.flag(candidate, 0x1c) || object.active;
    const isSelf = candidate === mover || candidate === this.objects[mover].link;

    return object.visible && object.image !== undefined && isCollidable && !isSelf;
  }

  private isHardPair(mover: number, candidate: number): boolean {
    const carries = this.flag(mover, 0x50) && this.flag(candidate, 0x54);
    const interacts = this.flag(mover, 0x20) && this.flag(candidate, 0x24);

    return carries || interacts;
  }

  private depthGate(
    mover: SceneObject,
    candidate: number,
    y: number,
    moduleNumber: number,
  ): boolean {
    const other = this.objects[candidate];
    const isScene = moduleNumber <= 6 || moduleNumber === 16;
    const isGarage = moduleNumber >= 7 && moduleNumber <= 9;

    if (isScene) {
      const above = other.def.raw.getInt16(0x6c, true);
      const below = other.def.raw.getInt16(0x6e, true);

      return other.y - above < y && y < other.y + below;
    }

    if (isGarage) {
      const above = mover.def.raw.getInt16(0x6c, true);
      const below = mover.def.raw.getInt16(0x6e, true);

      return y - above < other.y && other.y < y + below;
    }

    return false;
  }

  private pixelsOverlap(
    image: IndexedImage,
    left: number,
    top: number,
    other: SceneObject,
  ): boolean {
    const otherImage = other.image;

    if (!otherImage) {
      return false;
    }

    const startX = Math.max(left, other.left);
    const startY = Math.max(top, other.top);
    const endX = Math.min(left + image.width, other.left + otherImage.width);
    const endY = Math.min(top + image.height, other.top + otherImage.height);

    for (let worldY = startY; worldY < endY; worldY += 1) {
      const rowHit = this.rowPixelsOverlap(image, left, top, other, worldY, startX, endX);

      if (rowHit) {
        return true;
      }
    }

    return false;
  }

  private rowPixelsOverlap(
    image: IndexedImage,
    left: number,
    top: number,
    other: SceneObject,
    worldY: number,
    startX: number,
    endX: number,
  ): boolean {
    const moverRow = (worldY - top) * image.width - left;

    for (let worldX = startX; worldX < endX; worldX += 1) {
      const moverOpaque = image.pixels[moverRow + worldX] !== TRANSPARENT_INDEX;

      if (moverOpaque && this.isOpaqueLocal(other, worldX, worldY)) {
        return true;
      }
    }

    return false;
  }

  overlaps(firstIndex: number, secondIndex: number): boolean {
    const first = this.objects[firstIndex];
    const second = this.objects[secondIndex];
    const firstImage = first.image;
    const secondImage = second.image;

    if (!firstImage || !secondImage) {
      return false;
    }

    const left = Math.max(first.left, second.left);
    const top = Math.max(first.top, second.top);
    const right = Math.min(first.left + firstImage.width, second.left + secondImage.width);
    const bottom = Math.min(first.top + firstImage.height, second.top + secondImage.height);

    for (let y = top; y < bottom; y += 1) {
      const hasOverlap = this.rowOverlaps(first, second, y, left, right);

      if (hasOverlap) {
        return true;
      }
    }

    return false;
  }

  private rowOverlaps(
    first: SceneObject,
    second: SceneObject,
    y: number,
    left: number,
    right: number,
  ): boolean {
    for (let x = left; x < right; x += 1) {
      const firstOpaque = this.isOpaqueLocal(first, x, y);
      const secondOpaque = this.isOpaqueLocal(second, x, y);

      if (firstOpaque && secondOpaque) {
        return true;
      }
    }

    return false;
  }

  private isOpaqueLocal(object: SceneObject, worldX: number, worldY: number): boolean {
    const image = object.image;

    if (!image) {
      return false;
    }

    const value = image.pixels[(worldY - object.top) * image.width + (worldX - object.left)];

    return value !== TRANSPARENT_INDEX;
  }

  private drawPan(framebuffer: Framebuffer): void {
    const pan = this.pan;

    if (!pan) {
      return;
    }

    const rightWidth = pan.width - this.panPos;

    framebuffer.blitOpaque(pan, this.panPos, 0, rightWidth, pan.height, 0, 0);
    framebuffer.blitOpaque(pan, 0, 0, this.panPos, pan.height, rightWidth, 0);
  }

  private drawObject(framebuffer: Framebuffer, object: SceneObject): void {
    if (!object.visible || !object.image) {
      return;
    }

    const isHud = object.type === HUD_TYPE;
    const screenLeft = isHud ? object.left : object.left - this.scrollX;

    framebuffer.drawTransparent(object.image, screenLeft, object.top);
  }

  private sortMiddleLayer(): void {
    const start = this.drawOrder.findIndex((index) => this.objects[index].type === SORTED_TYPE);

    if (start === -1) {
      return;
    }

    const end =
      this.drawOrder.findLastIndex((index) => this.objects[index].type === SORTED_TYPE) + 1;
    const middle = this.drawOrder.slice(start, end);

    middle.sort(
      (first, second) => bottomEdge(this.objects[first]) - bottomEdge(this.objects[second]),
    );
    this.drawOrder.splice(start, middle.length, ...middle);
  }

  private isOpaqueAt(object: SceneObject, worldX: number, worldY: number): boolean {
    const image = object.image;

    if (!object.visible || !image) {
      return false;
    }

    const isHud = object.type === HUD_TYPE;
    const pointX = isHud ? worldX - this.scrollX : worldX;
    const localX = pointX - object.left;
    const localY = worldY - object.top;
    const inside = localX >= 0 && localY >= 0 && localX < image.width && localY < image.height;

    if (!inside) {
      return false;
    }

    const value = image.pixels[localY * image.width + localX];

    return value !== TRANSPARENT_INDEX;
  }

  private refreshStaticImage(object: SceneObject): void {
    if (object.def.streamed || object.def.frameCount === 0) {
      return;
    }

    const frame = Math.min(object.frame, object.def.frameCount - 1);
    const image = decodeFrame(this.module, object.def, frame);

    object.image = image;
    object.left = object.x - (image.width >> 1);
    object.top = object.y - (image.height >> 1);
  }
}
