import type { Engine, ModuleLogic } from "../engine/engine";

const VEHICLES_PER_PAGE = 5;
const PAGE_COUNT = 3;
const LAST_VEHICLE = 13;
const CORNER = 14;
const SPEC_SHEET = 15;
const PRINT = 17;
const FIRST_NARRATION = 18;
const LAST_NARRATION = 59;
const INTRO = 60;
const GUIDE_LEAVES = 61;
const BACK = 63;
const NEXT = 64;
const SUB_PAGES = 3;

interface InfoState {
  page: number;
  subPage: number;
  narration: number;
  returnTo: number;
}

const info: InfoState = { page: 0, subPage: 0, narration: 0, returnTo: 10 };

function pageObjects(page: number): number[] {
  const first = page * VEHICLES_PER_PAGE;

  return Array.from({ length: VEHICLES_PER_PAGE }, (_, offset) => first + offset);
}

function enter(engine: Engine): number {
  const scene = engine.requireScene();

  info.page = 0;
  info.subPage = 0;
  info.narration = 0;
  info.returnTo = engine.previousModule === 14 ? info.returnTo : engine.previousModule;
  engine.stopStream(SPEC_SHEET, "rewind");
  engine.stopStream(INTRO, "rewind");
  engine.stopStream(GUIDE_LEAVES, "rewind");
  scene.setFrame(CORNER, 0);
  scene.objects[INTRO].finished = false;

  return INTRO;
}

function openVehicle(engine: Engine, vehicle: number): void {
  const scene = engine.requireScene();

  engine.hide(PRINT);
  scene.setFrame(SPEC_SHEET, vehicle * SUB_PAGES);
  engine.show(SPEC_SHEET);
  info.subPage = 0;
  info.narration = FIRST_NARRATION + vehicle * SUB_PAGES;
  engine.play(info.narration, 2, true);
}

async function turnPage(engine: Engine): Promise<void> {
  const scene = engine.requireScene();

  await engine.sfx("pageturn");

  for (const index of pageObjects(info.page)) {
    engine.hide(index);
  }

  info.page = (info.page + 1) % PAGE_COUNT;

  for (const index of pageObjects(info.page)) {
    engine.show(index);
  }

  engine.show(CORNER);
  scene.setFrame(CORNER, (scene.objects[CORNER].frame + 1) % PAGE_COUNT);
}

function advanceSubPage(engine: Engine): void {
  const scene = engine.requireScene();
  const isNarrating = info.narration >= FIRST_NARRATION && info.narration <= LAST_NARRATION;

  engine.hide(NEXT);
  engine.hide(PRINT);

  if (!isNarrating) {
    return;
  }

  info.subPage += 1;

  if (info.subPage < SUB_PAGES) {
    scene.setFrame(SPEC_SHEET, scene.objects[SPEC_SHEET].frame + 1);
    info.narration += 1;
    engine.play(info.narration, 2, true);
    return;
  }

  engine.hide(SPEC_SHEET);
}

async function clickNext(engine: Engine): Promise<void> {
  await engine.sfx("btnclik1");
  advanceSubPage(engine);
}

async function clickPrint(engine: Engine): Promise<void> {
  await engine.sfx("btnclik1");
  engine.hide(PRINT);
  engine.hide(NEXT);
  engine.printScreen();
  engine.show(PRINT);
  engine.show(NEXT);
}

function click(engine: Engine, object: number): void {
  if (object <= LAST_VEHICLE) {
    openVehicle(engine, object);
    return;
  }

  const actions = new Map<number, () => void>([
    [CORNER, () => turnPage(engine).catch(() => undefined)],
    [PRINT, () => clickPrint(engine).catch(() => undefined)],
    [NEXT, () => clickNext(engine).catch(() => undefined)],
    [
      BACK,
      () => {
        engine.hide(INTRO);
        engine.play(GUIDE_LEAVES, 2, true);
      },
    ],
  ]);

  actions.get(object)?.();
}

function finished(engine: Engine, object: number): void {
  const isNarration = object >= FIRST_NARRATION && object <= LAST_NARRATION;

  if (isNarration) {
    engine.show(PRINT);
    engine.show(NEXT);
    info.narration = object;
    return;
  }

  if (object === GUIDE_LEAVES) {
    engine.goto(info.returnTo).catch(() => undefined);
  }
}

function speechEnded(engine: Engine, object: number): void {
  const isNarration = object >= FIRST_NARRATION && object <= LAST_NARRATION;

  if (!isNarration) {
    finished(engine, object);
    return;
  }

  engine.stopStream(object, "rewind");
  info.narration = object;
  advanceSubPage(engine);
}

export const vehicleInfo: ModuleLogic = {
  enter,
  click,
  finished,
  speechEnded,
  forgetOnLeave: true,
};
