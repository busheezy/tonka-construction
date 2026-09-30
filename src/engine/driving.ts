export const HEADINGS = 12;

const HEADING_DX = [0, 0.5, 0.87, 1, 0.87, 0.5, 0, -0.5, -0.87, -1, -0.87, -0.5];
const HEADING_DY = [-0.75, -0.65, -0.35, 0, 0.35, 0.65, 0.75, 0.65, 0.35, 0, -0.35, -0.65];
const SPEED_FACTORS = [1, 0.8, 0.6, 0.4, 0.2, 1, 1];
const DEAD_ZONE = 2;
const MIN_SPEED = 5;
const STEP_LIMIT = 6;
const STEP_BONUS_CAP = 320;
const WIDE_SPRITE = 300;
const REVERSE_THRESHOLD = 4;

export interface SteerResult {
  dx: number;
  dy: number;
  heading: number;
  reversing: boolean;
}

function verticalSector(dy: number): number {
  return dy < 0 ? 0 : 6;
}

function horizontalSector(dx: number): number {
  return dx > 0 ? 3 : 9;
}

function quadrantSector(dx: number, dy: number, ratio: number): number {
  const east = dx > 0;
  const north = dy < 0;
  const sectors = [
    [11, 1],
    [7, 5],
  ];
  const row = north ? 0 : 1;
  const column = east ? 1 : 0;
  const nearVertical = sectors[row][column];

  if (ratio > 1) {
    return nearVertical;
  }

  return north === east ? nearVertical + 1 : nearVertical - 1;
}

export function sectorFor(dx: number, dy: number): number {
  if (dx === 0) {
    return dy === 0 ? 0 : verticalSector(dy);
  }

  if (dy === 0) {
    return horizontalSector(dx);
  }

  const ratio = Math.abs(dy / dx);

  if (ratio > 4) {
    return verticalSector(dy);
  }

  if (ratio <= 0.25) {
    return horizontalSector(dx);
  }

  return quadrantSector(dx, dy, ratio);
}

export function turnDifference(from: number, to: number): number {
  const raw = (to - from + HEADINGS) % HEADINGS;

  return raw > HEADINGS / 2 ? raw - HEADINGS : raw;
}

function wrapHeading(heading: number): number {
  return (heading + HEADINGS) % HEADINGS;
}

function limitStep(value: number, spriteWidth: number): number {
  const magnitude = Math.abs(value);

  if (magnitude <= STEP_LIMIT) {
    return Math.trunc(value);
  }

  const bonusScale = spriteWidth < WIDE_SPRITE ? 1 : 0;
  const bonus = Math.trunc(Math.min(magnitude, STEP_BONUS_CAP) * 0.1 * bonusScale) >> 1;
  const limited = STEP_LIMIT + bonus;

  return Math.sign(value) * limited;
}

export function steer(heading: number, dx: number, dy: number, spriteWidth: number): SteerResult {
  const idle = { dx: 0, dy: 0, heading, reversing: false };

  if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) {
    return idle;
  }

  const target = sectorFor(dx, dy);
  const difference = turnDifference(heading, target);
  const magnitude = Math.abs(difference);
  const turn = magnitude >= 2 ? Math.sign(difference) : 0;
  const newHeading = wrapHeading(heading + turn);
  const reversing = magnitude > REVERSE_THRESHOLD;
  const speed = Math.hypot(dx, dy) * SPEED_FACTORS[magnitude];

  if (speed < MIN_SPEED) {
    return idle;
  }

  const direction = reversing ? wrapHeading(heading + HEADINGS / 2) : newHeading;
  const facing = reversing ? heading : newHeading;
  const moveX = limitStep(speed * HEADING_DX[direction], spriteWidth);
  const moveY = limitStep(speed * HEADING_DY[direction], spriteWidth);

  return { dx: moveX, dy: moveY, heading: facing, reversing };
}

export function readShorts(bytes: Uint8Array): Int16Array {
  const count = Math.floor(bytes.length / 2);
  const values = new Int16Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let index = 0; index < count; index += 1) {
    values[index] = view.getInt16(index * 2, true);
  }

  return values;
}

export interface PathStep {
  dx: number;
  dy: number;
}

export function readPath(bytes: Uint8Array): PathStep[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getInt32(0, true);
  const available = Math.floor((bytes.length - 4) / 8);
  const count = Math.min(declared, available);

  return Array.from({ length: count }, (_, index) => {
    const offset = 4 + index * 8;
    const dx = view.getInt32(offset, true);
    const dy = view.getInt32(offset + 4, true);

    return { dx, dy };
  });
}

export interface AttachPoint {
  x: number;
  y: number;
}

export function readAttachPoints(bytes: Uint8Array): AttachPoint[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.length / 8);

  return Array.from({ length: count }, (_, index) => {
    const x = view.getInt16(index * 8, true);
    const y = view.getInt16(index * 8 + 4, true);

    return { x, y };
  });
}
