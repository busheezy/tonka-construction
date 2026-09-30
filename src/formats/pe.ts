const RESOURCE_DIRECTORY_INDEX = 2;
const RT_CURSOR = 1;
const SUBDIRECTORY_FLAG = 0x80000000;
const CURSOR_SIZE = 32;
const CURSOR_ROW_BYTES = 4;
const CURSOR_MASK_BYTES = CURSOR_ROW_BYTES * CURSOR_SIZE;

interface Section {
  virtualAddress: number;
  virtualSize: number;
  rawOffset: number;
  rawSize: number;
}

export interface CursorImage {
  hotspotX: number;
  hotspotY: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export class PeImage {
  readonly imageBase: number;
  private readonly view: DataView;
  private readonly sections: Section[];
  private readonly resourceRva: number;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const peOffset = this.view.getUint32(0x3c, true);
    const signature = this.view.getUint32(peOffset, true);

    if (signature !== 0x4550) {
      throw new Error("Not a PE executable");
    }

    const sectionCount = this.view.getUint16(peOffset + 6, true);
    const optionalHeaderSize = this.view.getUint16(peOffset + 20, true);
    const optionalHeader = peOffset + 24;
    const dataDirectories = optionalHeader + 96;
    const resourceEntry = dataDirectories + RESOURCE_DIRECTORY_INDEX * 8;
    const sectionTable = optionalHeader + optionalHeaderSize;

    this.imageBase = this.view.getUint32(optionalHeader + 28, true);
    this.resourceRva = this.view.getUint32(resourceEntry, true);
    this.sections = this.readSections(sectionTable, sectionCount);
  }

  readVirtual(address: number, length: number): Uint8Array {
    const rva = address - this.imageBase;
    const offset = this.rvaToOffset(rva);

    return this.bytes.subarray(offset, offset + length);
  }

  viewVirtual(address: number, length: number): DataView {
    const slice = this.readVirtual(address, length);

    return new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
  }

  cursor(id: number): CursorImage {
    const data = this.findResource(RT_CURSOR, id);

    return decodeCursor(data);
  }

  private readSections(tableOffset: number, count: number): Section[] {
    const sections: Section[] = [];

    for (let index = 0; index < count; index += 1) {
      const entry = tableOffset + index * 40;
      const virtualSize = this.view.getUint32(entry + 8, true);
      const virtualAddress = this.view.getUint32(entry + 12, true);
      const rawSize = this.view.getUint32(entry + 16, true);
      const rawOffset = this.view.getUint32(entry + 20, true);

      sections.push({ virtualAddress, virtualSize, rawOffset, rawSize });
    }

    return sections;
  }

  private rvaToOffset(rva: number): number {
    const section = this.sections.find((candidate) => {
      const size = Math.max(candidate.virtualSize, candidate.rawSize);
      const end = candidate.virtualAddress + size;

      return rva >= candidate.virtualAddress && rva < end;
    });

    if (!section) {
      throw new Error(`Address outside the executable: ${rva.toString(16)}`);
    }

    return rva - section.virtualAddress + section.rawOffset;
  }

  private findDirectoryEntry(directoryRva: number, id: number | undefined): number {
    const directory = this.rvaToOffset(directoryRva);
    const namedCount = this.view.getUint16(directory + 12, true);
    const idCount = this.view.getUint16(directory + 14, true);
    const total = namedCount + idCount;

    for (let index = 0; index < total; index += 1) {
      const entry = directory + 16 + index * 8;
      const entryId = this.view.getUint32(entry, true);
      const matches = id === undefined || entryId === id;

      if (matches) {
        return this.view.getUint32(entry + 4, true);
      }
    }

    throw new Error(`Resource ${id} not found`);
  }

  private findResource(type: number, id: number): Uint8Array {
    const typeEntry = this.findDirectoryEntry(this.resourceRva, type);
    const typeDirectory = this.resourceRva + (typeEntry & ~SUBDIRECTORY_FLAG);
    const nameEntry = this.findDirectoryEntry(typeDirectory, id);
    const nameDirectory = this.resourceRva + (nameEntry & ~SUBDIRECTORY_FLAG);
    const languageEntry = this.findDirectoryEntry(nameDirectory, undefined);
    const dataEntry = this.rvaToOffset(this.resourceRva + languageEntry);
    const dataRva = this.view.getUint32(dataEntry, true);
    const dataSize = this.view.getUint32(dataEntry + 4, true);
    const dataOffset = this.rvaToOffset(dataRva);

    return this.bytes.subarray(dataOffset, dataOffset + dataSize);
  }
}

function maskBit(mask: Uint8Array, x: number, y: number): number {
  const row = CURSOR_SIZE - 1 - y;
  const byte = mask[row * CURSOR_ROW_BYTES + (x >> 3)];
  const shift = 7 - (x & 7);

  return (byte >> shift) & 1;
}

function cursorPixel(andBit: number, xorBit: number): [number, number] {
  if (andBit === 1 && xorBit === 0) {
    return [0, 0];
  }

  if (andBit === 0 && xorBit === 1) {
    return [255, 255];
  }

  return [0, 255];
}

function decodeCursor(data: Uint8Array): CursorImage {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const hotspotX = view.getUint16(0, true);
  const hotspotY = view.getUint16(2, true);
  const headerSize = view.getUint32(4, true);
  const colorsStart = 4 + headerSize;
  const xorStart = colorsStart + 8;
  const andStart = xorStart + CURSOR_MASK_BYTES;
  const xorMask = data.subarray(xorStart, andStart);
  const andMask = data.subarray(andStart, andStart + CURSOR_MASK_BYTES);
  const rgba = new Uint8ClampedArray(CURSOR_SIZE * CURSOR_SIZE * 4);

  for (let y = 0; y < CURSOR_SIZE; y += 1) {
    for (let x = 0; x < CURSOR_SIZE; x += 1) {
      const andBit = maskBit(andMask, x, y);
      const xorBit = maskBit(xorMask, x, y);
      const [shade, alpha] = cursorPixel(andBit, xorBit);
      const target = (y * CURSOR_SIZE + x) * 4;

      rgba[target] = shade;
      rgba[target + 1] = shade;
      rgba[target + 2] = shade;
      rgba[target + 3] = alpha;
    }
  }

  return { hotspotX, hotspotY, width: CURSOR_SIZE, height: CURSOR_SIZE, rgba };
}
