import type { IndexedImage } from "./module";

const HEADER_SIZE = 128;
const RUN_FLAG = 0xc0;
const RUN_MASK = 0x3f;

export function parsePcx(bytes: Uint8Array): IndexedImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minX = view.getUint16(4, true);
  const minY = view.getUint16(6, true);
  const maxX = view.getUint16(8, true);
  const maxY = view.getUint16(10, true);
  const bytesPerLine = view.getUint16(66, true);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const decoded = new Uint8Array(bytesPerLine * height);
  let readIndex = HEADER_SIZE;
  let writeIndex = 0;

  while (writeIndex < decoded.length && readIndex < bytes.length) {
    const value = bytes[readIndex];
    const isRun = (value & RUN_FLAG) === RUN_FLAG;
    const count = isRun ? value & RUN_MASK : 1;
    const pixel = isRun ? bytes[readIndex + 1] : value;

    decoded.fill(pixel, writeIndex, Math.min(decoded.length, writeIndex + count));
    writeIndex += count;
    readIndex += isRun ? 2 : 1;
  }

  const pixels = new Uint8Array(width * height);

  for (let row = 0; row < height; row += 1) {
    const line = decoded.subarray(row * bytesPerLine, row * bytesPerLine + width);

    pixels.set(line, row * width);
  }

  return { width, height, pixels };
}
