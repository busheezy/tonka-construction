export function unpackBits(source: Uint8Array, outputSize: number): Uint8Array {
  const output = new Uint8Array(outputSize);
  let readIndex = 0;
  let writeIndex = 0;

  while (writeIndex < outputSize && readIndex < source.length) {
    const control = source[readIndex];

    readIndex += 1;

    if (control < 128) {
      const literalLength = Math.min(control + 1, outputSize - writeIndex);
      const literal = source.subarray(readIndex, readIndex + literalLength);

      output.set(literal, writeIndex);
      readIndex += control + 1;
      writeIndex += literalLength;
      continue;
    }

    const runLength = Math.min(257 - control, outputSize - writeIndex);
    const value = source[readIndex];

    output.fill(value, writeIndex, writeIndex + runLength);
    readIndex += 1;
    writeIndex += runLength;
  }

  return output;
}
