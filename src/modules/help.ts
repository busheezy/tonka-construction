import type { Engine, ModuleLogic } from "../engine/engine";

const TILES_PER_PAGE = 4;

interface HelpLayout {
  tiles: number;
  valid: number;
}

const LAYOUTS = new Map<number, HelpLayout>([
  [51, { tiles: 4, valid: 4 }],
  [52, { tiles: 8, valid: 6 }],
  [53, { tiles: 8, valid: 8 }],
  [54, { tiles: 4, valid: 4 }],
  [55, { tiles: 12, valid: 10 }],
  [56, { tiles: 16, valid: 16 }],
  [57, { tiles: 4, valid: 4 }],
  [58, { tiles: 4, valid: 4 }],
  [59, { tiles: 4, valid: 4 }],
]);

interface HelpObjects {
  tiles: number;
  valid: number;
  enlarged: number;
  enlargedCaptions: number;
  narrations: number;
  back: number;
  previous: number;
  next: number;
  guide: number;
  guideExit: number;
  overlay: number;
  pageCount: number;
}

interface HelpState {
  page: number;
}

const help: HelpState = { page: 0 };

function objectsFor(engine: Engine): HelpObjects {
  const layout = LAYOUTS.get(engine.moduleNumber);

  if (!layout) {
    throw new Error(`No help layout for module ${engine.moduleNumber}`);
  }

  const tiles = layout.tiles;
  const back = 5 * tiles;

  return {
    tiles,
    valid: layout.valid,
    enlarged: 2 * tiles,
    enlargedCaptions: 3 * tiles,
    narrations: 4 * tiles,
    back,
    previous: back + 1,
    next: back + 2,
    guide: back + 3,
    guideExit: back + 4,
    overlay: back + 5,
    pageCount: tiles / TILES_PER_PAGE,
  };
}

function groupStart(index: number): number {
  return index - (index % TILES_PER_PAGE);
}

function setGroupVisible(
  engine: Engine,
  objects: HelpObjects,
  first: number,
  visible: boolean,
): void {
  const scene = engine.requireScene();

  for (let offset = 0; offset < TILES_PER_PAGE; offset += 1) {
    const tile = first + offset;

    scene.setVisible(objects.enlarged + tile, visible);
    scene.setVisible(objects.enlargedCaptions + tile, visible);
  }
}

function setPageVisible(
  engine: Engine,
  objects: HelpObjects,
  page: number,
  visible: boolean,
): void {
  const scene = engine.requireScene();
  const first = page * TILES_PER_PAGE;

  for (let offset = 0; offset < TILES_PER_PAGE; offset += 1) {
    const tile = first + offset;

    scene.setVisible(tile, visible);
    scene.setVisible(objects.tiles + tile, visible);
  }
}

function updateArrows(engine: Engine, objects: HelpObjects): void {
  const scene = engine.requireScene();
  const hasNext = help.page < objects.pageCount - 1;
  const hasPrevious = help.page > 0;

  scene.setVisible(objects.next, hasNext);
  scene.setVisible(objects.previous, hasPrevious);
}

function enter(engine: Engine): number | undefined {
  const scene = engine.requireScene();
  const objects = objectsFor(engine);

  for (const object of scene.objects) {
    const initiallyVisible = object.def.raw.getUint32(0x10, true) !== 0;

    object.visible = initiallyVisible;
  }

  help.page = 0;
  updateArrows(engine, objects);

  return undefined;
}

function narrate(engine: Engine, objects: HelpObjects, tile: number): void {
  engine.requireScene().setFrame(objects.enlarged + tile, 1);
  engine.play(objects.narrations + tile, 2, true);
}

function openTile(engine: Engine, objects: HelpObjects, tile: number): void {
  engine.show(objects.overlay);
  setGroupVisible(engine, objects, groupStart(tile), true);
  narrate(engine, objects, tile);
}

function closeEnlarged(engine: Engine, objects: HelpObjects): void {
  const scene = engine.requireScene();

  for (let index = objects.enlarged; index < objects.back; index += 1) {
    scene.setVisible(index, false);
  }

  scene.setVisible(objects.overlay, false);
}

async function turnPage(engine: Engine, objects: HelpObjects, delta: number): Promise<void> {
  const target = help.page + delta;
  const isInRange = target >= 0 && target < objects.pageCount;

  await engine.sfx("btnclik1");

  if (!isInRange) {
    return;
  }

  setPageVisible(engine, objects, help.page, false);
  help.page = target;
  setPageVisible(engine, objects, help.page, true);
  updateArrows(engine, objects);
}

function click(engine: Engine, object: number): void {
  const objects = objectsFor(engine);
  const isValidTile = object < objects.valid;

  if (isValidTile) {
    openTile(engine, objects, object);
    return;
  }

  if (object === objects.back) {
    engine.hide(objects.guide);
    engine.play(objects.guideExit, 2, true);
    return;
  }

  if (object === objects.previous) {
    turnPage(engine, objects, -1).catch(() => undefined);
    return;
  }

  if (object === objects.next) {
    turnPage(engine, objects, 1).catch(() => undefined);
  }
}

function continueNarration(engine: Engine, objects: HelpObjects, tile: number): void {
  const next = tile + 1;

  engine.requireScene().setFrame(objects.enlarged + tile, 0);

  if (next >= objects.valid) {
    closeEnlarged(engine, objects);
    return;
  }

  const startsNewGroup = next % TILES_PER_PAGE === 0;

  if (startsNewGroup) {
    setGroupVisible(engine, objects, groupStart(tile), false);
    setGroupVisible(engine, objects, next, true);
  }

  narrate(engine, objects, next);
}

function leaveToActivity(engine: Engine, objects: HelpObjects): void {
  const scene = engine.requireScene();
  const activity = engine.moduleNumber - 50;

  engine.stopStream(objects.guideExit, "rewind");
  engine.stopStream(objects.guide, "rewind");
  scene.objects[objects.guide].finished = false;
  engine.goto(activity).catch(() => undefined);
}

function finished(engine: Engine, object: number): void {
  const objects = objectsFor(engine);
  const isNarration = object >= objects.narrations && object < objects.back;

  if (isNarration) {
    continueNarration(engine, objects, object - objects.narrations);
    return;
  }

  if (object === objects.guideExit) {
    leaveToActivity(engine, objects);
  }
}

function speechEnded(engine: Engine, object: number): void {
  const objects = objectsFor(engine);
  const isNarration = object >= objects.narrations && object < objects.back;

  if (!isNarration) {
    finished(engine, object);
    return;
  }

  engine.requireScene().setFrame(objects.enlarged + object - objects.narrations, 0);
  closeEnlarged(engine, objects);
}

export const helpScreen: ModuleLogic = {
  enter,
  click,
  finished,
  speechEnded,
  backTarget: (engine) => engine.moduleNumber - 50,
};
