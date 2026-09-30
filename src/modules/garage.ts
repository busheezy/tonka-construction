import type { Engine, ModuleLogic } from "../engine/engine";

const SHELF = 0;
const FIRST_POT = 2;
const LAST_POT = 7;
const SPRAY_CAN = 8;
const WRENCH = 9;
const SPRAY_HOME_X = 373;
const SPRAY_HOME_Y = 412;
const BACK_SIGN = 1;
const TRAY_LEFT = 0;
const TRAY_RIGHT = 518;
const TRAY_TOP = 366;
const TRAY_BOTTOM = 480;
const SPRAY_ZONE_BOTTOM = 340;
const PAINT_ENTRY = 0xd8;
const DEFAULT_PAINT = 4;
const POT_PALETTE_ENTRIES = new Map<number, number>([
  [2, 0xa0],
  [3, 0xb0],
  [4, 0x90],
  [5, 0x98],
  [6, 0xa8],
  [7, 0xb8],
]);

interface PartGroup {
  part: number;
  reveal: number[];
  bolts: number[];
  praise: number[];
}

interface GarageConfig {
  tray: number;
  icons: number[];
  keys: number;
  soap: number;
  finale: number;
  cab: number;
  hints: number[];
  washable: number[];
  groups: PartGroup[];
}

interface GarageState {
  placed: number[];
  done: number[];
  paintPhase: boolean;
  currentPaint: number;
}

function everyOther(first: number, last: number): number[] {
  const values: number[] = [];

  for (let value = first; value <= last; value += 2) {
    values.push(value);
  }

  return values;
}

const MONSTER_SPARE_ICONS = everyOther(37, 47);
const DOZER_ICONS = everyOther(16, 32);
const GRADER_SPARE_ICONS = everyOther(29, 39);

const CONFIGS = new Map<number, GarageConfig>([
  [
    7,
    {
      tray: 13,
      icons: [15, 19, 21, ...MONSTER_SPARE_ICONS],
      keys: 48,
      soap: 67,
      finale: 50,
      cab: 71,
      hints: [15, 19, 21],
      washable: [10, 11, 14, 16, 18, 20],
      groups: [
        { part: 14, reveal: [16], bolts: [22, 23, 24, 25, 26, 27, 28, 29], praise: [52, 53] },
        { part: 18, reveal: [], bolts: [33], praise: [55] },
        { part: 20, reveal: [], bolts: [34, 35], praise: [54] },
      ],
    },
  ],
  [
    8,
    {
      tray: 14,
      icons: DOZER_ICONS,
      keys: 38,
      soap: 57,
      finale: 42,
      cab: 81,
      hints: [16, 18, 20],
      washable: [10, 11, 12, 15, 17, 19],
      groups: [
        { part: 15, reveal: [], bolts: [33], praise: [44] },
        { part: 17, reveal: [], bolts: [36, 37], praise: [45] },
        { part: 19, reveal: [], bolts: [34, 35], praise: [43] },
      ],
    },
  ],
  [
    9,
    {
      tray: 14,
      icons: [16, 20, 22, ...GRADER_SPARE_ICONS],
      keys: 40,
      soap: 58,
      finale: 42,
      cab: 91,
      hints: [16, 20, 22],
      washable: [10, 11, 12, 15, 18, 19, 21, 23],
      groups: [
        { part: 15, reveal: [17, 18], bolts: [24, 25], praise: [45] },
        { part: 19, reveal: [], bolts: [], praise: [44] },
        { part: 21, reveal: [23], bolts: [26], praise: [46] },
      ],
    },
  ],
]);

function configFor(engine: Engine): GarageConfig {
  const config = CONFIGS.get(engine.moduleNumber);

  if (!config) {
    throw new Error(`No garage config for module ${engine.moduleNumber}`);
  }

  return config;
}

function stateFor(engine: Engine): GarageState {
  return engine.state<GarageState>(() => ({
    placed: [],
    done: [],
    paintPhase: false,
    currentPaint: DEFAULT_PAINT,
  }));
}

function isIcon(engine: Engine, index: number): boolean {
  const object = engine.requireScene().objects[index];

  return object.def.raw.getUint32(0x78, true) !== 0;
}

function isInsideTray(x: number, y: number): boolean {
  return x > TRAY_LEFT && x < TRAY_RIGHT && y > TRAY_TOP && y < TRAY_BOTTOM;
}

function iconToPart(engine: Engine, icon: number): void {
  const scene = engine.requireScene();
  const part = icon - 1;
  const iconObject = scene.objects[icon];

  scene.moveTo(part, iconObject.x, iconObject.y);
  scene.setFrame(part, 0);
  scene.setVisible(icon, false);
  engine.hold(part);
}

function partToIcon(engine: Engine, part: number): void {
  const scene = engine.requireScene();
  const icon = part + 1;
  const partDef = scene.objects[part].def;

  scene.setVisible(part, false);
  scene.moveTo(part, partDef.x, partDef.y);
  engine.hold(icon);
}

function dragMove(engine: Engine, held: number, x: number, y: number): boolean {
  const scene = engine.requireScene();
  const heldIsIcon = isIcon(engine, held);

  if (heldIsIcon) {
    return dragIcon(engine, held, x, y);
  }

  const twin = scene.objects[held + 1];
  const hasIconTwin =
    twin !== undefined && isIcon(engine, held + 1) && held !== SPRAY_CAN && held !== WRENCH;

  if (hasIconTwin && isInsideTray(x, y)) {
    partToIcon(engine, held);
    return false;
  }

  return true;
}

function dragIcon(engine: Engine, icon: number, x: number, y: number): boolean {
  const leavesSideways = x <= TRAY_LEFT || x >= TRAY_RIGHT;
  const leavesVertically = y <= TRAY_TOP || y >= TRAY_BOTTOM;

  if (leavesSideways) {
    return false;
  }

  if (leavesVertically) {
    iconToPart(engine, icon);
    return false;
  }

  return true;
}

function snapTarget(engine: Engine, index: number): [number, number] {
  const raw = engine.requireScene().objects[index].def.raw;
  const targetX = raw.getInt16(0x7c, true);
  const targetY = raw.getInt16(0x7e, true);

  return [targetX, targetY];
}

function isNear(engine: Engine, index: number, targetX: number, targetY: number): boolean {
  const object = engine.requireScene().objects[index];
  const width = object.image?.width ?? 0;
  const height = object.image?.height ?? 0;

  return Math.abs(object.x - targetX) < width && Math.abs(object.y - targetY) < height;
}

async function heldClickAsync(engine: Engine, held: number): Promise<void> {
  const scene = engine.requireScene();

  if (isIcon(engine, held)) {
    const def = scene.objects[held].def;

    scene.moveTo(held, def.x, def.y);
    engine.release();
    return;
  }

  if (held === SPRAY_CAN || held === WRENCH) {
    await useTool(engine, held);
    return;
  }

  await dropPart(engine, held);
}

async function dropPart(engine: Engine, part: number): Promise<void> {
  const scene = engine.requireScene();
  const [targetX, targetY] = snapTarget(engine, part);

  if (targetX <= 0) {
    await engine.sfx("wrngpart");
    return;
  }

  const isClose = isNear(engine, part, targetX, targetY);

  if (!isClose) {
    return;
  }

  engine.release();
  scene.moveTo(part, targetX, targetY);
  scene.setFrame(part, 1);
  placePart(engine, part);
}

function placePart(engine: Engine, part: number): void {
  const config = configFor(engine);
  const state = stateFor(engine);
  const group = config.groups.find((candidate) => candidate.part === part);

  if (!group || state.placed.includes(part)) {
    return;
  }

  state.placed.push(part);

  for (const index of [...group.reveal, ...group.bolts]) {
    engine.show(index);
  }

  if (group.bolts.length === 0) {
    state.done.push(part);
    engine.play(group.praise[0], 2, true);
    return;
  }

  engine.hold(WRENCH);
}

async function useTool(engine: Engine, tool: number): Promise<void> {
  const scene = engine.requireScene();
  const isSprayAtHome = tool === SPRAY_CAN && isNear(engine, SPRAY_CAN, SPRAY_HOME_X, SPRAY_HOME_Y);

  if (isSprayAtHome) {
    scene.moveTo(SPRAY_CAN, SPRAY_HOME_X, SPRAY_HOME_Y);
    engine.release();
    return;
  }

  const soundName = tool === SPRAY_CAN ? "spray" : "wrench";

  scene.setFrame(tool, 1);
  await engine.sfx(soundName);

  if (tool === SPRAY_CAN) {
    paintUnderCursor(engine);
  } else {
    tightenUnderWrench(engine);
  }

  scene.setFrame(tool, 0);
}

function hasFlag(engine: Engine, index: number, offset: number): boolean {
  return engine.requireScene().objects[index].def.raw.getUint32(offset, true) !== 0;
}

function paintUnderCursor(engine: Engine): void {
  const scene = engine.requireScene();
  const [worldX, worldY] = engine.cursorWorld();
  const target = scene.hitTest(worldX, worldY);

  if (target === undefined || target === SPRAY_CAN) {
    return;
  }

  const object = scene.objects[target];
  const isPaintable = object.active && object.visible && hasFlag(engine, target, 0x34);

  if (!isPaintable) {
    return;
  }

  scene.setFrame(target, stateFor(engine).currentPaint);
  object.active = true;
}

function isTightenable(engine: Engine, index: number): boolean {
  const scene = engine.requireScene();
  const object = scene.objects[index];
  const matchesWrench = hasFlag(engine, index, 0x2c) && hasFlag(engine, WRENCH, 0x28);

  return (
    index !== WRENCH &&
    object.visible &&
    object.active &&
    matchesWrench &&
    scene.overlaps(WRENCH, index)
  );
}

function tightenUnderWrench(engine: Engine): void {
  const scene = engine.requireScene();
  const topmostFirst = [...scene.drawOrder].reverse();
  const target = topmostFirst.find((index) => isTightenable(engine, index));

  if (target === undefined) {
    return;
  }

  const object = scene.objects[target];
  const nextFrame = object.frame + 1;
  const isLastFrame = nextFrame >= object.def.frameCount - 1;

  scene.setFrame(target, nextFrame);

  if (isLastFrame && object.keepLastFrame) {
    object.active = false;
  }
}

function isTight(engine: Engine, bolt: number): boolean {
  return engine.requireScene().objects[bolt].frame !== 0;
}

function checkGroups(engine: Engine): boolean {
  const config = configFor(engine);
  const state = stateFor(engine);
  const scene = engine.requireScene();

  for (const group of config.groups) {
    const allTight = group.bolts.length > 0 && group.bolts.every((bolt) => isTight(engine, bolt));
    const isNewlyDone = allTight && scene.heldObject === WRENCH && !state.done.includes(group.part);

    if (!isNewlyDone) {
      continue;
    }

    engine.hide(WRENCH);
    engine.release();
    state.done.push(group.part);

    const praise = group.praise[engine.random(group.praise.length)];

    engine.play(praise, 2, true);

    return true;
  }

  return false;
}

function allGroupsDone(engine: Engine): boolean {
  const config = configFor(engine);
  const state = stateFor(engine);

  return config.groups.every((group) => state.done.includes(group.part));
}

function enterPaintPhase(engine: Engine): void {
  const config = configFor(engine);
  const state = stateFor(engine);

  state.paintPhase = true;
  engine.hide(config.tray);

  for (const icon of config.icons) {
    engine.hide(icon);
  }

  for (let index = SHELF; index <= LAST_POT; index += 1) {
    engine.show(index);
  }

  engine.show(config.soap);
  engine.show(config.keys);

  const stopsPaletteCycle = engine.moduleNumber === 8;

  if (stopsPaletteCycle) {
    engine.setPaletteCycling(false);
  }
}

function isOverBackSign(engine: Engine, x: number, y: number): boolean {
  const sign = engine.requireScene().objects[BACK_SIGN];
  const halfWidth = (sign.image?.width ?? 0) >> 1;
  const halfHeight = (sign.image?.height ?? 0) >> 1;

  return Math.abs(x - sign.x) <= halfWidth && Math.abs(y - sign.y) <= halfHeight;
}

function autoHoldSprayCan(engine: Engine): void {
  const scene = engine.requireScene();
  const [x, y] = engine.cursorWorld();
  const inWorkArea = y < SPRAY_ZONE_BOTTOM && !isOverBackSign(engine, x, y);
  const held = scene.heldObject;

  if (held === undefined && inWorkArea) {
    engine.hold(SPRAY_CAN);
    return;
  }

  if (held === SPRAY_CAN && !inWorkArea) {
    engine.hide(SPRAY_CAN);
    engine.release();
  }
}

function hover(engine: Engine): void {
  const state = stateFor(engine);

  if (checkGroups(engine)) {
    return;
  }

  if (state.paintPhase) {
    autoHoldSprayCan(engine);
  }
}

async function wash(engine: Engine): Promise<void> {
  const config = configFor(engine);
  const scene = engine.requireScene();
  const isPainted = config.washable.some((index) => scene.objects[index].frame > 1);

  if (!isPainted) {
    return;
  }

  await engine.sfx("splash");

  for (const index of config.washable) {
    scene.setFrame(index, 1);
  }
}

async function clickAsync(engine: Engine, object: number): Promise<void> {
  const config = configFor(engine);
  const isPot = object >= FIRST_POT && object <= LAST_POT;

  if (isPot) {
    const entry = POT_PALETTE_ENTRIES.get(object) ?? PAINT_ENTRY;

    stateFor(engine).currentPaint = object;
    engine.copyPaletteEntry(PAINT_ENTRY, entry);
    await engine.sfx("btnclik2");
    return;
  }

  if (object === config.soap) {
    await wash(engine);
    return;
  }

  if (object === config.keys) {
    await wash(engine);
    await engine.sfx("latch");
    await engine.goto(config.cab);
  }
}

function finished(engine: Engine, object: number): void {
  const config = configFor(engine);
  const isPraise = config.groups.some((group) => group.praise.includes(object));

  if (!isPraise || !allGroupsDone(engine)) {
    return;
  }

  enterPaintPhase(engine);
  engine.play(config.finale, 2, true);
}

function idle(engine: Engine): void {
  const config = configFor(engine);
  const scene = engine.requireScene();
  const skipsThisTime = engine.random(100) === 0;
  const hint = config.hints.find((icon) => scene.objects[icon].visible);

  if (skipsThisTime || hint === undefined) {
    engine.armIdle();
    return;
  }

  engine.blink(hint);
}

function enter(engine: Engine): undefined {
  stateFor(engine).currentPaint = DEFAULT_PAINT;
  engine.restorePaletteEntry(PAINT_ENTRY);

  return undefined;
}

export const garage: ModuleLogic = {
  enter,
  click: (engine, object) => {
    clickAsync(engine, object).catch(() => undefined);
  },
  pickUp: (engine) => {
    engine.sfx("btnclik2").catch(() => undefined);
  },
  dragMove,
  heldClick: (engine, held) => {
    heldClickAsync(engine, held).catch(() => undefined);
  },
  hover,
  finished,
  idle,
  backTarget: () => 12,
};
