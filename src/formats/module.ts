import { unpackBits } from "./packbits";

const MODULE_HEADER_SIZE = 0xb0;
const PALETTE_SIZE = 0x400;
const BACKGROUND_HEADER_SIZE = 0x18;
const OBJECT_DEF_SIZE = 0x80;
const FRAME_HEADER_SIZE = 0x18;
const FIRST_CHUNK_DOUBLE_SOUND = 22050;
const CHUNK_HEADER_SIZE = 0x18;

export const TRANSPARENT_INDEX = 0x0f;

export interface ModuleHeader {
  hasPan: number;
  paletteAnimation: number;
  introObject: number;
  scrollBase: number;
  label: string;
  raw: DataView;
}

export interface IndexedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface ObjectDef {
  index: number;
  offset: number;
  end: number;
  type: number;
  headings: number;
  sets: number;
  framesPerSet: number;
  frameCount: number;
  streamed: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  initialFrame: number;
  raw: DataView;
}

export interface StreamChunk {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  sound: Uint8Array;
  image: Uint8Array;
}

export interface GameModule {
  number: number;
  bytes: Uint8Array;
  header: ModuleHeader;
  palette: Uint8Array;
  background: IndexedImage;
  objects: ObjectDef[];
}

function viewOf(bytes: Uint8Array, offset: number, length: number): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length);
}

function readLabel(bytes: Uint8Array, offset: number, length: number): string {
  const slice = bytes.subarray(offset, offset + length);
  const terminator = slice.indexOf(0);
  const end = terminator === -1 ? length : terminator;
  const decoder = new TextDecoder("latin1");

  return decoder.decode(slice.subarray(0, end));
}

function parseHeader(bytes: Uint8Array, offset: number): ModuleHeader {
  const raw = viewOf(bytes, offset, MODULE_HEADER_SIZE);
  const hasPan = raw.getUint16(2, true);
  const paletteAnimation = raw.getUint16(6, true);
  const introObject = raw.getUint16(8, true);
  const scrollBase = raw.getUint16(0xc, true);
  const label = readLabel(bytes, offset + 0x10, 0x50);

  return { hasPan, paletteAnimation, introObject, scrollBase, label, raw };
}

function parsePalette(bytes: Uint8Array, offset: number): Uint8Array {
  const palette = new Uint8Array(256 * 3);

  for (let index = 0; index < 256; index += 1) {
    const source = offset + index * 4;

    palette[index * 3] = bytes[source + 2];
    palette[index * 3 + 1] = bytes[source + 1];
    palette[index * 3 + 2] = bytes[source];
  }

  return palette;
}

function parseBackground(bytes: Uint8Array, offset: number): IndexedImage {
  const view = viewOf(bytes, offset, BACKGROUND_HEADER_SIZE);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const start = offset + BACKGROUND_HEADER_SIZE;
  const pixels = bytes.subarray(start, start + width * height);

  return { width, height, pixels };
}

function parseObjectDef(bytes: Uint8Array, index: number, offset: number, end: number): ObjectDef {
  const raw = viewOf(bytes, offset, OBJECT_DEF_SIZE);
  const type = raw.getUint16(0, true);
  const streamed = raw.getUint16(8, true) !== 0;
  const headings = raw.getUint16(2, true);
  const sets = raw.getUint16(4, true);
  const framesPerSet = raw.getUint16(6, true);
  const staticFrameCount = Math.max(1, headings) * Math.max(1, sets) * framesPerSet;
  const frameCount = streamed ? framesPerSet : staticFrameCount;
  const width = raw.getUint16(0xa, true);
  const height = raw.getUint16(0xc, true);
  const x = raw.getInt16(0x64, true);
  const y = raw.getInt16(0x66, true);
  const initialFrame = raw.getUint16(0x6a, true);

  return {
    index,
    offset,
    end,
    type,
    headings,
    sets,
    framesPerSet,
    frameCount,
    streamed,
    width,
    height,
    x,
    y,
    initialFrame,
    raw,
  };
}

export function parseModule(moduleNumber: number, bytes: Uint8Array): GameModule {
  const view = viewOf(bytes, 0, bytes.length);
  const objectCount = view.getUint16(0, true);
  const offsets: number[] = [];

  for (let index = 0; index < objectCount; index += 1) {
    const offset = view.getUint32(2 + index * 4, true);

    offsets.push(offset);
  }

  const headerOffset = 2 + objectCount * 4;
  const paletteOffset = headerOffset + MODULE_HEADER_SIZE;
  const backgroundOffset = paletteOffset + PALETTE_SIZE;
  const header = parseHeader(bytes, headerOffset);
  const palette = parsePalette(bytes, paletteOffset);
  const background = parseBackground(bytes, backgroundOffset);
  const objects = offsets.map((offset, index) => {
    const nextOffset = offsets[index + 1] ?? bytes.length;

    return parseObjectDef(bytes, index, offset, nextOffset);
  });

  return { number: moduleNumber, bytes, header, palette, background, objects };
}

export function decodeFrame(module: GameModule, object: ObjectDef, frame: number): IndexedImage {
  const view = viewOf(module.bytes, 0, module.bytes.length);
  const tableOffset = object.offset + OBJECT_DEF_SIZE + frame * 4;
  const frameOffset = view.getUint32(tableOffset, true);
  const width = view.getUint32(frameOffset, true);
  const height = view.getUint32(frameOffset + 4, true);
  const packedSize = view.getUint32(frameOffset + 12, true);
  const dataStart = frameOffset + FRAME_HEADER_SIZE;
  const packed = module.bytes.subarray(dataStart, dataStart + packedSize);
  const pixels = unpackBits(packed, width * height);

  markLastPixelTransparent(pixels);

  return { width, height, pixels };
}

function markLastPixelTransparent(pixels: Uint8Array): void {
  if (pixels.length > 0) {
    pixels[pixels.length - 1] = TRANSPARENT_INDEX;
  }
}

function storedSoundBytes(chunkIndex: number, soundBytes: number): number {
  const isDoubledFirstChunk = chunkIndex === 0 && soundBytes === FIRST_CHUNK_DOUBLE_SOUND;

  if (isDoubledFirstChunk) {
    return soundBytes * 2;
  }

  return soundBytes;
}

const EMPTY_BYTES = new Uint8Array(0);

function emptyChunk(): StreamChunk {
  return { width: 0, height: 0, offsetX: 0, offsetY: 0, sound: EMPTY_BYTES, image: EMPTY_BYTES };
}

function readChunk(
  bytes: Uint8Array,
  cursor: number,
  index: number,
  limit: number,
): [StreamChunk, number] {
  const headerEnd = cursor + CHUNK_HEADER_SIZE;

  if (headerEnd > limit) {
    return [emptyChunk(), limit];
  }

  const view = viewOf(bytes, cursor, CHUNK_HEADER_SIZE);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const imageBytes = view.getUint32(12, true);
  const declaredSoundBytes = view.getUint32(16, true);
  const soundBytes = storedSoundBytes(index, declaredSoundBytes);
  const offsetX = view.getInt16(20, true);
  const offsetY = view.getInt16(22, true);
  const imageStart = headerEnd + soundBytes;
  const imageEnd = imageStart + imageBytes;

  if (imageEnd > limit) {
    return [emptyChunk(), limit];
  }

  const sound = bytes.subarray(headerEnd, imageStart);
  const image = bytes.subarray(imageStart, imageEnd);
  const chunk = { width, height, offsetX, offsetY, sound, image };

  return [chunk, imageEnd];
}

export function readStreamChunks(module: GameModule, object: ObjectDef): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  let cursor = object.offset + OBJECT_DEF_SIZE;

  for (let index = 0; index < object.frameCount; index += 1) {
    const [chunk, next] = readChunk(module.bytes, cursor, index, object.end);

    chunks.push(chunk);
    cursor = next;
  }

  return chunks;
}

export function decodeChunkImage(chunk: StreamChunk): IndexedImage | undefined {
  if (chunk.image.length === 0) {
    return undefined;
  }

  const width = chunk.width;
  const height = chunk.height;
  const pixels = unpackBits(chunk.image, width * height);

  markLastPixelTransparent(pixels);

  return { width, height, pixels };
}
