import type { Engine, ModuleLogic } from "../engine/engine";
import { ACTIVITY_CASTLE, ACTIVITY_HIRISE, ACTIVITY_PARK, EMPTY_LOT } from "../engine/progress";

const LOT_OBJECTS = [
  { park: 0, castle: 1, hirise: 2, empty: 3 },
  { park: 4, castle: 5, hirise: 6, empty: 7 },
  { park: 8, castle: 9, hirise: 10, empty: 11 },
];
const INTRO = 12;
const LOOK_AT_LOT = 13;
const REENTRY_LINE = 14;
const ALL_DONE_LINE = 15;
const EMPTY_LOTS = [3, 7, 11];
const LAST_LOT_OBJECT = 11;
const HELP_SCREENS_START = 50;
const CITY_SITE = 16;

interface LotObjects {
  park: number;
  castle: number;
  hirise: number;
  empty: number;
}

function projectObject(lot: LotObjects, project: number): number {
  if (project === 4) {
    return lot.park;
  }

  if (project === 5) {
    return lot.castle;
  }

  return lot.hirise;
}

function activityForProject(project: number): number {
  return project - 4 + ACTIVITY_PARK;
}

function showLot(engine: Engine, lotIndex: number): void {
  const scene = engine.requireScene();
  const project = engine.progress.lotProject[lotIndex];

  if (project === EMPTY_LOT) {
    return;
  }

  const lot = LOT_OBJECTS[lotIndex];
  const object = projectObject(lot, project);
  const activity = activityForProject(project);
  const isDone = engine.progress.done[activity];
  const frame = isDone ? 1 : 0;

  scene.setVisible(lot.empty, false);
  scene.setVisible(object, true);
  scene.setFrame(object, frame);
}

function chooseIntro(engine: Engine): number | undefined {
  const scene = engine.requireScene();
  const progress = engine.progress;
  const allDone =
    progress.done[ACTIVITY_PARK] &&
    progress.done[ACTIVITY_CASTLE] &&
    progress.done[ACTIVITY_HIRISE];
  const introHeard = scene.objects[INTRO].finished;
  const cameFromHelp = engine.previousModule >= HELP_SCREENS_START;

  if (allDone) {
    scene.objects[ALL_DONE_LINE].finished = false;

    return ALL_DONE_LINE;
  }

  if (introHeard && !cameFromHelp) {
    scene.objects[REENTRY_LINE].finished = false;

    return REENTRY_LINE;
  }

  return undefined;
}

function enter(engine: Engine): number | undefined {
  const scene = engine.requireScene();
  const intro = scene.objects[INTRO];

  for (let lotIndex = 0; lotIndex < LOT_OBJECTS.length; lotIndex += 1) {
    showLot(engine, lotIndex);
  }

  if (intro.finished && intro.visible) {
    scene.setVisible(INTRO, false);
  }

  return chooseIntro(engine);
}

function click(engine: Engine, object: number): void {
  const isEmptyLot = EMPTY_LOTS.includes(object);

  engine.progress.cityLot = object;

  if (!isEmptyLot) {
    return;
  }

  engine.hide(INTRO);
  engine.play(LOOK_AT_LOT, 2, true);
}

function finished(engine: Engine, object: number): void {
  if (object === LOOK_AT_LOT) {
    engine.goto(CITY_SITE).catch(() => undefined);
  }
}

function rememberLot(engine: Engine, object: number): void {
  engine.progress.cityLot = object;
}

function hover(engine: Engine, object: number | undefined): void {
  if (object === undefined || object > LAST_LOT_OBJECT) {
    return;
  }

  engine.input.setCursor("hand");
}

export const cityMap: ModuleLogic = {
  enter,
  click,
  beforeLink: rememberLot,
  finished,
  speechEnded: finished,
  backTarget: () => 10,
  hover,
};
