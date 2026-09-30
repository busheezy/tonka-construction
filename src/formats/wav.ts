export interface PcmSound {
  sampleRate: number;
  samples: Float32Array<ArrayBuffer>;
}

function findChunk(view: DataView, id: string): { start: number; size: number } | undefined {
  let cursor = 12;

  while (cursor + 8 <= view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(cursor),
      view.getUint8(cursor + 1),
      view.getUint8(cursor + 2),
      view.getUint8(cursor + 3),
    );
    const size = view.getUint32(cursor + 4, true);
    const start = cursor + 8;

    if (chunkId === id) {
      return { start, size };
    }

    const padding = size % 2;

    cursor = start + size + padding;
  }

  return undefined;
}

export function pcm8ToFloat(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    samples[index] = (bytes[index] - 128) / 128;
  }

  return samples;
}

function pcm16ToFloat(view: DataView, start: number, size: number): Float32Array<ArrayBuffer> {
  const count = Math.floor(size / 2);
  const samples = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    samples[index] = view.getInt16(start + index * 2, true) / 32768;
  }

  return samples;
}

export function parseWav(bytes: Uint8Array): PcmSound {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = findChunk(view, "fmt ");
  const data = findChunk(view, "data");

  if (!format || !data) {
    throw new Error("Not a PCM WAV file");
  }

  const sampleRate = view.getUint32(format.start + 4, true);
  const bitsPerSample = view.getUint16(format.start + 14, true);
  const dataEnd = Math.min(data.start + data.size, bytes.length);
  const dataSize = dataEnd - data.start;

  if (bitsPerSample === 16) {
    const samples = pcm16ToFloat(view, data.start, dataSize);

    return { sampleRate, samples };
  }

  const pcm = bytes.subarray(data.start, dataEnd);
  const samples = pcm8ToFloat(pcm);

  return { sampleRate, samples };
}
