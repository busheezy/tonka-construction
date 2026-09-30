import type { Engine, ModuleLogic } from "../engine/engine";
import { readSlot, SAVE_SLOT_COUNT, writeSlot } from "../engine/save-slots";

const QUIT = 0;
const GO_BACK = 1;
const OPEN = 2;
const SAVE = 3;
const NEW = 4;
const NEW_GAME_PROMPT = 5;
const FIRST_BADGE = 6;
const LAST_BADGE = 13;
const MASTER_BADGE = 13;
const QUIT_PROMPT = 15;
const SAVE_PROMPT = 17;
const OVERWRITE_PROMPT = 18;
const NEVER_MIND = 20;
const SLOT_HEADER = 21;
const FIRST_SLOT = 22;
const OK = 32;
const NO_WAY = 33;
const LOAD_PROMPT = 34;
const CANCEL = 35;
const CREDITS = 36;
const MASTER_SPEECH = 37;
const CREDIT_FRAMES = 11;
const TEXT_COLOR = "rgb(32,32,32)";
const LARGE_FONT = "bold 32px Arial, Helvetica, sans-serif";
const SMALL_FONT = "bold 20px Arial, Helvetica, sans-serif";
const COUNT_POSITIONS: [number, number][] = [
  [186, 322],
  [186, 243],
  [186, 163],
  [519, 321],
  [519, 241],
  [519, 161],
  [344, 322],
];

type CardMode = "quit" | "open" | "save" | "new";

interface CardState {
  mode: CardMode;
  slot: number;
}

const card: CardState = { mode: "open", slot: 0 };

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

function showAll(engine: Engine, indices: number[]): void {
  for (const index of indices) {
    engine.show(index);
  }
}

function hideAll(engine: Engine, indices: number[]): void {
  for (const index of indices) {
    engine.hide(index);
  }
}

function drawText(
  engine: Engine,
  key: string,
  text: string,
  x: number,
  y: number,
  font = LARGE_FONT,
): void {
  engine.framebuffer.overlays.set(key, { text, x, y, font, color: TEXT_COLOR });
}

function clearSlotTexts(engine: Engine): void {
  for (let slot = 0; slot < SAVE_SLOT_COUNT; slot += 1) {
    engine.framebuffer.overlays.delete(`slot${slot}`);
  }
}

function slotPosition(slot: number): [number, number] {
  const x = 110 + 260 * Math.floor(slot / 5);
  const y = 115 + 49 * (slot % 5);

  return [x, y];
}

function showSlotList(engine: Engine): void {
  engine.show(SLOT_HEADER);

  for (let slot = 0; slot < SAVE_SLOT_COUNT; slot += 1) {
    const save = readSlot(slot);
    const name = save?.playerName ?? "Unused Slot";
    const [x, y] = slotPosition(slot);

    engine.show(FIRST_SLOT + slot);
    drawText(engine, `slot${slot}`, name, x, y);
  }
}

function hideSlotList(engine: Engine): void {
  hideAll(engine, range(SLOT_HEADER, NO_WAY));
  engine.hide(CANCEL);
  clearSlotTexts(engine);
}

function badgeFrame(engine: Engine, activity: number): number {
  return engine.progress.done[activity] ? 0 : 1;
}

function showBadges(engine: Engine): void {
  const scene = engine.requireScene();
  const progress = engine.progress;

  for (let badge = FIRST_BADGE; badge < MASTER_BADGE; badge += 1) {
    const activity = badge - FIRST_BADGE;
    const count = progress.timesCompleted[activity];
    const position = COUNT_POSITIONS[activity];

    scene.setFrame(badge, badgeFrame(engine, activity));
    scene.setVisible(badge, count !== 0);

    if (count > 1) {
      const capped = Math.min(count, 99);

      drawText(engine, `count${activity}`, String(capped), position[0], position[1], SMALL_FONT);
    }
  }

  scene.setVisible(MASTER_BADGE, progress.masterBuilder);
}

function showCard(engine: Engine): number | undefined {
  const scene = engine.requireScene();

  drawText(engine, "name", engine.playerName, 128, 61);
  showAll(engine, range(QUIT, NEW));
  hideSlotList(engine);
  showBadges(engine);

  const masterUnheard = engine.progress.masterBuilder && !scene.objects[MASTER_SPEECH].finished;

  return masterUnheard ? MASTER_SPEECH : undefined;
}

function showLoadList(engine: Engine): void {
  card.mode = "open";
  hideAll(engine, [GO_BACK, OPEN, SAVE]);
  engine.show(QUIT);
  engine.show(NEW);
  showSlotList(engine);
}

function enter(engine: Engine): number | undefined {
  engine.framebuffer.overlays.clear();

  if (engine.playerName.length === 0) {
    showLoadList(engine);
    return 0;
  }

  return showCard(engine);
}

function askConfirmation(engine: Engine, prompt: number): void {
  hideAll(engine, range(QUIT, NEW));
  engine.show(OK);
  engine.show(NO_WAY);
  engine.play(prompt, 2, true);
}

function openSlotList(engine: Engine, mode: CardMode): void {
  card.mode = mode;
  hideAll(engine, range(QUIT, NEW));
  showSlotList(engine);
  engine.show(CANCEL);

  if (mode === "save") {
    engine.play(SAVE_PROMPT, 2, true);
  }
}

function chooseSlot(engine: Engine, slot: number): void {
  const exists = readSlot(slot) !== undefined;
  const isSaving = card.mode !== "open";

  card.slot = slot;

  if (isSaving) {
    const [x, y] = slotPosition(slot);

    drawText(engine, `slot${slot}`, engine.playerName, x, y);
  }

  if (!exists && !isSaving) {
    return;
  }

  engine.hide(CANCEL);
  engine.hide(QUIT);
  engine.hide(NEW);
  engine.show(OK);
  engine.show(NO_WAY);

  if (exists) {
    const prompt = isSaving ? OVERWRITE_PROMPT : LOAD_PROMPT;

    engine.play(prompt, 2, true);
  }
}

function returnToCard(engine: Engine): void {
  hideSlotList(engine);
  engine.framebuffer.overlays.clear();

  const speech = showCard(engine);

  if (speech !== undefined) {
    engine.play(speech, 1, true);
  }
}

function startNewGame(engine: Engine): void {
  engine.resetSession(13);
  engine.forgetModules([13]);
  engine.goto(15).catch(() => undefined);
}

function openSave(engine: Engine): void {
  const save = readSlot(card.slot);

  if (!save) {
    return;
  }

  engine.restoreSave(save, 13);
  returnToCard(engine);
}

function confirm(engine: Engine): void {
  if (card.mode === "quit") {
    hideAll(engine, [OK, NO_WAY]);
    engine.requireScene().setFrame(CREDITS, 0);
    engine.show(CREDITS);
    engine.armIdle();
    return;
  }

  if (card.mode === "new") {
    startNewGame(engine);
    return;
  }

  if (card.mode === "open") {
    openSave(engine);
    return;
  }

  writeSlot(card.slot, engine.serialize());
  returnToCard(engine);
}

function decline(engine: Engine): void {
  if (engine.playerName.length > 0) {
    returnToCard(engine);
  } else {
    hideAll(engine, [OK, NO_WAY]);
    engine.show(QUIT);
    engine.show(NEW);
  }

  engine.play(NEVER_MIND, 2, true);
}

function clickNew(engine: Engine): void {
  if (engine.playerName.length === 0) {
    startNewGame(engine);
    return;
  }

  card.mode = "new";
  askConfirmation(engine, NEW_GAME_PROMPT);
}

async function clickBadge(engine: Engine, badge: number): Promise<void> {
  const scene = engine.requireScene();
  const isComplete = scene.objects[badge].frame === 0;

  await engine.sfx("btnclik1");

  if (isComplete) {
    await engine.goto(badge + 55);
  }
}

function quitGame(engine: Engine): void {
  engine.resetSession(13);
  location.reload();
}

function click(engine: Engine, object: number): void {
  const isBadge = object >= FIRST_BADGE && object <= LAST_BADGE;
  const isSlot = object >= FIRST_SLOT && object < FIRST_SLOT + SAVE_SLOT_COUNT;
  const actions = new Map<number, () => void>([
    [
      QUIT,
      () => {
        card.mode = "quit";
        askConfirmation(engine, QUIT_PROMPT);
      },
    ],
    [GO_BACK, () => engine.goto(10).catch(() => undefined)],
    [OPEN, () => openSlotList(engine, "open")],
    [SAVE, () => openSlotList(engine, "save")],
    [NEW, () => clickNew(engine)],
    [OK, () => confirm(engine)],
    [NO_WAY, () => decline(engine)],
    [CANCEL, () => returnToCard(engine)],
    [CREDITS, () => quitGame(engine)],
  ]);

  if (isBadge) {
    clickBadge(engine, object).catch(() => undefined);
    return;
  }

  if (isSlot) {
    chooseSlot(engine, object - FIRST_SLOT);
    return;
  }

  actions.get(object)?.();
}

function idle(engine: Engine): void {
  const credits = engine.requireScene().objects[CREDITS];

  if (!credits.visible) {
    return;
  }

  const nextFrame = credits.frame + 1;

  if (nextFrame >= CREDIT_FRAMES) {
    quitGame(engine);
    return;
  }

  engine.requireScene().setFrame(CREDITS, nextFrame);
  engine.armIdle();
}

export const timeCard: ModuleLogic = {
  enter,
  click,
  idle,
};
