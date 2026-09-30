import type { Engine, ModuleLogic } from "../engine/engine";

const FINISHED_OVERLAY_COUNT = 6;
const DOZER_DRIVE = 6;
const MONSTER_DRIVE = 7;
const GRADER_DRIVE = 8;
const INTRO = 9;
const FIRST_GUIDE_LINE = 10;
const LAST_GUIDE_LINE = 14;
const FIRST_CHATTER = 15;
const LAST_CHATTER = 20;
const IDLE_CHOICES = 10;
const FIRST_REGION = 38;
const LAST_REGION = 42;
const REGION_TO_LINE = FIRST_REGION - FIRST_GUIDE_LINE;
const TIME_CLOCK = 43;
const TRUCK_DRIVES = [DOZER_DRIVE, MONSTER_DRIVE, GRADER_DRIVE];

const GUIDE_LINE_DESTINATIONS = new Map<number, number>([
  [10, 1],
  [11, 2],
  [12, 3],
  [13, 11],
  [14, 12],
]);

interface MapState {
  lastIdlePick: number;
}

function mapState(engine: Engine): MapState {
  return engine.state<MapState>(() => ({ lastIdlePick: -1 }));
}

function isBuilt(engine: Engine, driveObject: number): boolean {
  const progress = engine.progress;

  if (driveObject === DOZER_DRIVE) {
    return progress.dozerBuilt;
  }

  if (driveObject === MONSTER_DRIVE) {
    return progress.monsterBuilt;
  }

  return progress.graderBuilt;
}

function pendingTruckDrive(engine: Engine): number | undefined {
  const scene = engine.requireScene();

  return TRUCK_DRIVES.find((drive) => !scene.objects[drive].visible && isBuilt(engine, drive));
}

function resetTruckDrives(engine: Engine): void {
  for (const drive of TRUCK_DRIVES) {
    engine.stopStream(drive, "rewind");
  }

  engine.progress.resetGarageAnimations = false;
}

function enter(engine: Engine): number | undefined {
  const scene = engine.requireScene();

  for (let index = 0; index < FINISHED_OVERLAY_COUNT; index += 1) {
    const isDone = engine.progress.done[index];

    scene.setVisible(index, isDone);
  }

  if (engine.progress.resetGarageAnimations) {
    resetTruckDrives(engine);
  }

  const drive = pendingTruckDrive(engine);

  if (drive === undefined) {
    return undefined;
  }

  scene.objects[drive].finished = false;

  return drive;
}

function clickRegion(engine: Engine, region: number): void {
  const scene = engine.requireScene();
  const line = region - REGION_TO_LINE;
  const heardBefore = scene.objects[line].finished;

  engine.hide(engine.progress.mapGuideObject);

  if (heardBefore) {
    engine.show(line);
    finished(engine, line);
    return;
  }

  engine.play(line, 2, true);
}

function goToDestination(engine: Engine, line: number): void {
  const destination = GUIDE_LINE_DESTINATIONS.get(line);

  if (destination === undefined) {
    return;
  }

  engine.progress.mapGuideObject = line;
  engine.goto(destination).catch(() => undefined);
}

function finished(engine: Engine, object: number): void {
  const isTruckDrive = TRUCK_DRIVES.includes(object);
  const isGuideLine = object >= FIRST_GUIDE_LINE && object <= LAST_GUIDE_LINE;
  const isStandingPose = object === INTRO || (object >= FIRST_CHATTER && object <= LAST_CHATTER);

  if (isTruckDrive) {
    engine.goto(12).catch(() => undefined);
    return;
  }

  if (isGuideLine) {
    goToDestination(engine, object);
    return;
  }

  if (isStandingPose) {
    engine.progress.mapGuideObject = object;
  }
}

function pickIdle(engine: Engine): number {
  const pick = FIRST_CHATTER + engine.random(IDLE_CHOICES);

  if (pick === mapState(engine).lastIdlePick) {
    return pickIdle(engine);
  }

  return pick;
}

function idle(engine: Engine): void {
  const skipsThisTime = engine.random(100) === 0;

  if (skipsThisTime) {
    engine.armIdle();
    return;
  }

  const pick = pickIdle(engine);
  const replacesGuide = pick <= LAST_CHATTER;

  mapState(engine).lastIdlePick = pick;

  if (replacesGuide) {
    engine.hide(engine.progress.mapGuideObject);
  }

  engine.play(pick, 2, replacesGuide);
}

function click(engine: Engine, object: number): void {
  const isRegion = object >= FIRST_REGION && object <= LAST_REGION;

  if (isRegion) {
    clickRegion(engine, object);
  }
}

function showsHand(object: number): boolean {
  const isFinishedOverlay = object < FINISHED_OVERLAY_COUNT;
  const isRegion = object >= FIRST_REGION && object <= LAST_REGION;

  return isFinishedOverlay || isRegion;
}

function hover(engine: Engine, object: number | undefined): void {
  if (object === undefined || !showsHand(object)) {
    return;
  }

  engine.input.setCursor("hand");
}

function linkSound(_engine: Engine, object: number): string | undefined {
  return object === TIME_CLOCK ? "timeclok" : undefined;
}

export const mainMap: ModuleLogic = {
  enter,
  linkSound,
  click,
  finished,
  speechEnded: finished,
  idle,
  hover,
};
