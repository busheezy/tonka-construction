import type { SaveGame } from "./engine";

export const SAVE_SLOT_COUNT = 10;
const KEY_PREFIX = "construction.save.";
const AUTOSAVE_KEY = "construction.autosave";

function keyFor(slot: number): string {
  return `${KEY_PREFIX}${slot}`;
}

export function readSlot(slot: number): SaveGame | undefined {
  try {
    const raw = localStorage.getItem(keyFor(slot));

    if (!raw) {
      return undefined;
    }

    return JSON.parse(raw) as SaveGame;
  } catch {
    return undefined;
  }
}

export function writeSlot(slot: number, save: SaveGame): boolean {
  try {
    const raw = JSON.stringify(save);

    localStorage.setItem(keyFor(slot), raw);

    return true;
  } catch {
    return false;
  }
}

export function anySlotUsed(): boolean {
  for (let slot = 0; slot < SAVE_SLOT_COUNT; slot += 1) {
    if (readSlot(slot)) {
      return true;
    }
  }

  return false;
}

export function readAutosave(): SaveGame | undefined {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);

    if (!raw) {
      return undefined;
    }

    return JSON.parse(raw) as SaveGame;
  } catch {
    return undefined;
  }
}

export function writeAutosave(save: SaveGame): void {
  try {
    const raw = JSON.stringify(save);

    localStorage.setItem(AUTOSAVE_KEY, raw);
  } catch {
    return;
  }
}
