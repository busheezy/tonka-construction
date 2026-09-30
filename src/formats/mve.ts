const HEADER_SIZE = 0x0c;
const RECORD_SIZE = 0x44;
const PALETTE_SIZE = 768;
const CLEAR_FLAG = 0x10000;
const PREROLL_RECORDS = 2;
export const MOVIE_WIDTH = 640;
export const MOVIE_HEIGHT = 480;

export interface MovieRecord {
  flags: number;
  audio: Uint8Array;
  x: number;
  y: number;
  width: number;
  height: number;
  video: Uint8Array;
  rawBytes: number;
}

export interface Movie {
  palette: Uint8Array;
  preroll: Uint8Array[];
  frames: MovieRecord[];
}

function readRecord(bytes: Uint8Array, view: DataView, offset: number): MovieRecord {
  const flags = view.getUint32(offset, true);
  const audioBytes = view.getUint32(offset + 0x08, true);
  const audioOffset = view.getUint32(offset + 0x0c, true);
  const x = view.getInt16(offset + 0x18, true);
  const y = view.getInt16(offset + 0x1a, true);
  const width = view.getInt16(offset + 0x1c, true);
  const height = view.getInt16(offset + 0x1e, true);
  const videoOffset = view.getUint32(offset + 0x20, true);
  const videoBytes = view.getUint32(offset + 0x24, true);
  const rawBytes = view.getUint32(offset + 0x28, true);
  const audio = bytes.subarray(audioOffset, audioOffset + audioBytes);
  const video = bytes.subarray(videoOffset, videoOffset + videoBytes);

  return { flags, audio, x, y, width, height, video, rawBytes };
}

export function parseMovie(bytes: Uint8Array): Movie {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = String.fromCharCode(...bytes.subarray(0, 4));

  if (signature !== "MVE4") {
    throw new Error("Not an MVE4 movie");
  }

  const tableSize = view.getUint32(4, true);
  const recordCount = Math.floor((tableSize - HEADER_SIZE) / RECORD_SIZE);
  const palette = bytes.subarray(tableSize, tableSize + PALETTE_SIZE);
  const records = Array.from({ length: recordCount }, (_, index) =>
    readRecord(bytes, view, HEADER_SIZE + index * RECORD_SIZE),
  );
  const preroll = records.slice(0, PREROLL_RECORDS).map((record) => record.audio);
  const frames = records.slice(PREROLL_RECORDS);

  return { palette, preroll, frames };
}

function xorRaw(screen: Uint8Array, frame: MovieRecord): void {
  for (let row = 0; row < frame.height; row += 1) {
    const target = (frame.y + row) * MOVIE_WIDTH + frame.x;
    const source = row * frame.width;

    for (let column = 0; column < frame.width; column += 1) {
      screen[target + column] ^= frame.video[source + column];
    }
  }
}

function xorRow(screen: Uint8Array, rowStart: number, width: number, data: Uint8Array): void {
  let position = 0;
  let column = 0;

  while (position < data.length) {
    const control = data[position];

    if (control < 0x80) {
      const count = control + 1;
      const end = Math.min(count, width - column);

      for (let offset = 0; offset < end; offset += 1) {
        screen[rowStart + column + offset] ^= data[position + 1 + offset];
      }

      column += count;
      position += 1 + count;
      continue;
    }

    const count = 257 - control;
    const value = data[position + 1];
    const end = Math.min(count, width - column);

    if (value !== 0) {
      for (let offset = 0; offset < end; offset += 1) {
        screen[rowStart + column + offset] ^= value;
      }
    }

    column += count;
    position += 2;
  }
}

function xorRunLength(screen: Uint8Array, frame: MovieRecord): void {
  const view = new DataView(frame.video.buffer, frame.video.byteOffset, frame.video.byteLength);
  let cursor = 0;

  for (let row = 0; row < frame.height && cursor + 2 <= frame.video.length; row += 1) {
    const rowBytes = view.getUint16(cursor, true);
    const data = frame.video.subarray(cursor + 2, cursor + 2 + rowBytes);
    const rowStart = (frame.y + row) * MOVIE_WIDTH + frame.x;

    xorRow(screen, rowStart, frame.width, data);
    cursor += 2 + rowBytes;
  }
}

export function applyMovieFrame(screen: Uint8Array, frame: MovieRecord): void {
  const clears = (frame.flags & CLEAR_FLAG) !== 0;

  if (clears) {
    screen.fill(frame.flags & 0xff);
    return;
  }

  if (frame.video.length === 0) {
    return;
  }

  if (frame.video.length === frame.rawBytes) {
    xorRaw(screen, frame);
    return;
  }

  xorRunLength(screen, frame);
}
