import { ACTIVITY_AVALANCHE } from "../../engine/progress";
import { createOutdoorLogic, type Outdoor } from "./outdoor";

const DOZER = 0;
const DOZER_PICTURE = 1;
const LOADER = 2;
const LOADER_PICTURE = 3;
const GRADER = 4;
const GRADER_PICTURE = 5;
const TOW_TRUCK = 6;
const TOW_PICTURE = 7;
const SEMI = 8;
const SNOW_BANK = [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37];
const POLAR_BEAR = 38;
const POLAR_BEAR_ALTERNATE = 39;
const RANGER_CAR = 42;
const SKI_LIFT = 43;
const BURIED_WORKERS = 44;
const TOWER = 47;
const TOWER_BASE = 48;
const JEEP_TOW = 49;
const PICKUP_TOW = 50;
const INTRO = 58;
const WORKERS = 60;
const SHOVELLING = 61;
const COCOA_ARRIVES = 62;
const COCOA_LEAVES = 63;
const TOWER_ARRIVED_LINE = 77;
const TASK_NARRATION = 78;
const TASK_CARD = 79;
const DECORATION_CHAIN = 85;
const DECORATIONS = [85, 86, 87, 88, 84, 55, 56, 57, 82, 83];
const TOWER_LIGHTS = 89;
const TOWER_ARROW = 90;
const IDLE_HINTS = [91, 92, 93, 94];
const COMPLETION_LINE = 95;
const DECORATIONS_ARRIVED = 105;
const REVISIT_INCOMPLETE = 106;
const REVISIT_COMPLETE = 107;
const RANGER_LINES_FIRST = 108;
const ICE_DONE_LINE = 115;
const PUFF = 116;
const GRADER_LIMIT_X = 1649;
const LOCKED_VEHICLES = [DOZER, LOADER, TOW_TRUCK];
const TOWER_SPOT = { left: 1570, right: 1716, top: 86, bottom: 236 };
const TOWER_X = 1649;
const TOWER_Y = 155;
const JEEP_BOX = { left: 551, right: 685, top: 223, bottom: 322 };
const PICKUP_BOX = { left: 669, right: 804, top: 200, bottom: 288 };
const HELP_FIRST = 50;
const HELP_LAST = 60;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const PILE_CLIPS = new Map<number, number>([
  [13, 12],
  [15, 11],
  [17, 10],
  [19, 9],
]);

const PICTURE_HINTS = new Map<number, { pending: number; done: number; check: number }>([
  [GRADER_PICTURE, { pending: 97, done: 101, check: 25 }],
  [DOZER_PICTURE, { pending: 98, done: 102, check: 20 }],
  [LOADER_PICTURE, { pending: 100, done: 104, check: 37 }],
  [TOW_PICTURE, { pending: 99, done: 103, check: PICKUP_TOW }],
]);

function isInside(box: Box, x: number, y: number): boolean {
  return x > box.left && x < box.right && y > box.top && y < box.bottom;
}

function isDone(outdoor: Outdoor): boolean {
  return outdoor.engine.progress.done[ACTIVITY_AVALANCHE];
}

function enter(outdoor: Outdoor): number | undefined {
  const intro = outdoor.scene.objects[INTRO];
  const previous = outdoor.engine.previousModule;
  const cameFromHelp = previous >= HELP_FIRST && previous <= HELP_LAST;

  outdoor.rewind(POLAR_BEAR);
  outdoor.engine.showStart(POLAR_BEAR);

  if (!intro.finished || cameFromHelp) {
    return undefined;
  }

  const revisit = isDone(outdoor) ? REVISIT_COMPLETE : REVISIT_INCOMPLETE;

  outdoor.scene.objects[revisit].finished = false;

  return revisit;
}

function axisLock(outdoor: Outdoor, vehicle: number, dx: number): number {
  const object = outdoor.scene.objects[vehicle];
  const halfWidth = (object.image?.width ?? 0) >> 1;
  const passesLimit = object.x + halfWidth + dx > GRADER_LIMIT_X;

  if (LOCKED_VEHICLES.includes(vehicle) && passesLimit) {
    return 0;
  }

  return dx;
}

function snapTowTruck(
  outdoor: Outdoor,
  x: number,
  y: number,
  heading: number,
  clip: number,
  flag: string,
): void {
  const scene = outdoor.scene;

  scene.moveTo(TOW_TRUCK, x, y);
  scene.setPose(TOW_TRUCK, heading, 0, 0);
  outdoor.setFlag(flag);
  outdoor.lock();
  outdoor.say(clip);
}

function vehicleClick(outdoor: Outdoor, vehicle: number): boolean {
  const object = outdoor.scene.objects[vehicle];

  if (vehicle !== TOW_TRUCK) {
    return false;
  }

  if (!outdoor.flag("jeepTowed") && isInside(JEEP_BOX, object.x, object.y)) {
    snapTowTruck(outdoor, 628, 269, 1, JEEP_TOW, "jeepTowed");
    return true;
  }

  if (!outdoor.flag("pickupTowed") && isInside(PICKUP_BOX, object.x, object.y)) {
    snapTowTruck(outdoor, 680, 247, 10, PICKUP_TOW, "pickupTowed");
    return true;
  }

  return false;
}

function vehicleMoved(outdoor: Outdoor, vehicle: number): void {
  const isTowHookDown = vehicle === TOW_TRUCK && outdoor.state.toolDown;

  if (isTowHookDown) {
    outdoor.raiseTool(vehicle);
  }
}

function worked(outdoor: Outdoor, target: number): void {
  const isCommentable = target >= 27 && target <= 33;

  if (!SNOW_BANK.includes(target)) {
    return;
  }

  outdoor.sfx(5);

  if (isCommentable && outdoor.engine.random(100) > (34 - target) * 8) {
    outdoor.say(outdoor.pick(71, 5));
  }
}

function dumped(outdoor: Outdoor, vehicle: number, under: number | undefined): boolean {
  const onWorkers =
    under === WORKERS && vehicle === LOADER && !outdoor.scene.objects[BURIED_WORKERS].playing;

  if (!onWorkers) {
    return false;
  }

  outdoor.prime(BURIED_WORKERS);
  outdoor.hide(WORKERS);
  outdoor.say(BURIED_WORKERS);

  return true;
}

function picturePicked(outdoor: Outdoor, picture: number): void {
  const hint = PICTURE_HINTS.get(picture);

  if (!hint) {
    return;
  }

  const taskStillOpen = outdoor.visible(hint.check);
  const firstPlaythrough = outdoor.engine.progress.timesCompleted[ACTIVITY_AVALANCHE] === 0;

  if (taskStillOpen && !firstPlaythrough) {
    return;
  }

  const clip = taskStillOpen ? hint.pending : hint.done;

  outdoor.lock();
  outdoor.say(clip);
}

function pictureReturned(outdoor: Outdoor, picture: number): void {
  const canOrderTower =
    picture === GRADER_PICTURE &&
    outdoor.scene.objects[ICE_DONE_LINE].finished &&
    !outdoor.flag("towerOrdered");

  if (!canOrderTower) {
    return;
  }

  outdoor.show(TOWER_BASE);
  outdoor.scene.objects[GRADER_PICTURE].grabbable = false;
  outdoor.setFlag("towerOrdered");
  outdoor.bringSemi(TOWER);
}

function itemDropped(outdoor: Outdoor, item: number): void {
  const scene = outdoor.scene;
  const object = scene.objects[item];
  const onSpot = item === TOWER && isInside(TOWER_SPOT, object.x, object.y);

  if (!onSpot) {
    return;
  }

  scene.moveTo(TOWER, TOWER_X, TOWER_Y);
  scene.setFrame(TOWER, 0);
  outdoor.hide(TOWER_ARROW);
  outdoor.show(TOWER_LIGHTS);

  for (const index of [TOWER, TOWER_LIGHTS, TOWER_BASE]) {
    outdoor.setLayer(index, 0);
  }

  object.grabbable = false;
  outdoor.say(SKI_LIFT);
}

function semiArrived(outdoor: Outdoor): void {
  outdoor.sfx(7);

  if (outdoor.semiCarries(TOWER)) {
    outdoor.show(TOWER_ARROW);
    outdoor.say(TOWER_ARRIVED_LINE);
    return;
  }

  if (outdoor.semiCarries(DECORATION_CHAIN)) {
    outdoor.say(DECORATIONS_ARRIVED);
  }
}

function linkDecorations(outdoor: Outdoor): void {
  const objects = outdoor.scene.objects;

  DECORATIONS.forEach((item, position) => {
    const next = DECORATIONS[position + 1] ?? -1;
    const previous = DECORATIONS[position - 1] ?? SEMI;
    const object = objects[item];

    object.link = next;
    object.carrier = previous;
  });
}

function semiLeft(outdoor: Outdoor): void {
  outdoor.hide(SEMI);
}

function click(outdoor: Outdoor, object: number): void {
  if (object === RANGER_CAR) {
    outdoor.say(outdoor.pick(RANGER_LINES_FIRST, 4));
  }
}

function clearPile(outdoor: Outdoor, pile: number): boolean {
  const clip = PILE_CLIPS.get(pile);

  if (clip === undefined) {
    return pile === 14 ? unlockAfter(outdoor) : false;
  }

  outdoor.lock();
  outdoor.say(clip);

  return true;
}

function unlockAfter(outdoor: Outdoor): boolean {
  outdoor.unlock();

  return true;
}

function towFinished(outdoor: Outdoor): void {
  const towedCount = [outdoor.flag("jeepTowed"), outdoor.flag("pickupTowed")].filter(
    Boolean,
  ).length;

  outdoor.unlock();

  if (towedCount === 1) {
    outdoor.say(70);
  }
}

function skiLiftFinished(outdoor: Outdoor): void {
  if (outdoor.flag("skiLiftPlayed")) {
    outdoor.engine.play(SKI_LIFT, 2, false);
    return;
  }

  outdoor.setFlag("skiLiftPlayed");
  outdoor.say(76);
}

function polarBearFinished(outdoor: Outdoor): void {
  if (!outdoor.flag("polarBearAlternate")) {
    return;
  }

  outdoor.setFlag("polarBearAlternate", false);
  outdoor.engine.stopStream(POLAR_BEAR, "none");
  outdoor.hide(POLAR_BEAR);
  outdoor.say(POLAR_BEAR_ALTERNATE);
}

function finishedSteps(outdoor: Outdoor): Map<number, () => void> {
  return new Map<number, () => void>([
    [9, () => outdoor.unlock()],
    [
      10,
      () => {
        outdoor.lock();
        outdoor.say(68);
      },
    ],
    [
      11,
      () => {
        outdoor.lock();
        outdoor.say(67);
      },
    ],
    [
      12,
      () => {
        outdoor.lock();
        outdoor.say(66);
        outdoor.show(LOADER_PICTURE, TOW_PICTURE);
      },
    ],
    [
      21,
      () => {
        outdoor.lock();
        outdoor.say(40);
      },
    ],
    [
      22,
      () => {
        outdoor.lock();
        outdoor.say(69);
      },
    ],
    [25, () => outdoor.say(ICE_DONE_LINE)],
    [26, () => outdoor.say(COCOA_ARRIVES)],
    [
      30,
      () => {
        outdoor.scene.objects[WORKERS].active = true;
      },
    ],
    [POLAR_BEAR, () => polarBearFinished(outdoor)],
    [
      POLAR_BEAR_ALTERNATE,
      () => {
        outdoor.hide(POLAR_BEAR_ALTERNATE);
        outdoor.engine.play(POLAR_BEAR, 2, false);
      },
    ],
    [SKI_LIFT, () => skiLiftFinished(outdoor)],
    [
      BURIED_WORKERS,
      () => {
        outdoor.rewind(BURIED_WORKERS);
        outdoor.show(WORKERS);
      },
    ],
    [JEEP_TOW, () => towFinished(outdoor)],
    [PICKUP_TOW, () => towFinished(outdoor)],
    [
      INTRO,
      () => {
        outdoor.show(TASK_CARD);
        outdoor.hide(INTRO);
        outdoor.say(TASK_NARRATION);
      },
    ],
    [
      SHOVELLING,
      () => {
        outdoor.hide(SHOVELLING);
        outdoor.show(WORKERS);
        outdoor.prime(COCOA_LEAVES);
        outdoor.hide(COCOA_ARRIVES);
        outdoor.say(COCOA_LEAVES);
      },
    ],
    [
      COCOA_ARRIVES,
      () => {
        outdoor.prime(SHOVELLING);
        outdoor.hide(WORKERS);
        outdoor.say(SHOVELLING);
      },
    ],
    [COCOA_LEAVES, () => outdoor.show(GRADER_PICTURE)],
    [
      76,
      () => {
        outdoor.complete(ACTIVITY_AVALANCHE);
        outdoor.say(COMPLETION_LINE);
      },
    ],
    [
      TASK_NARRATION,
      () => {
        outdoor.prime(64);
        outdoor.say(64);
        outdoor.hide(TASK_CARD);
      },
    ],
    [
      COMPLETION_LINE,
      () => {
        linkDecorations(outdoor);
        outdoor.bringSemi(DECORATION_CHAIN);
      },
    ],
  ]);
}

const UNLOCKING_CLIPS = [40, 41, 66, 67, 68, 69, 97, 98, 99, 100, 101, 102, 103, 104];

function finished(outdoor: Outdoor, object: number): void {
  if (UNLOCKING_CLIPS.includes(object)) {
    outdoor.unlock();
    return;
  }

  const step = finishedSteps(outdoor).get(object);

  if (step) {
    step();
    return;
  }

  clearPile(outdoor, object);
}

function speechSkipped(outdoor: Outdoor, object: number): boolean {
  const isIntroPart = [INTRO, 64, TASK_NARRATION].includes(object);

  if (!isIntroPart) {
    return false;
  }

  outdoor.hide(object, TASK_CARD);

  return true;
}

function idle(outdoor: Outdoor): void {
  if (!isDone(outdoor)) {
    outdoor.say(outdoor.pickIdle(IDLE_HINTS));
  }
}

export const avalanche = createOutdoorLogic({
  moduleNumber: 2,
  semi: SEMI,
  puffAnimation: PUFF,
  pictures: new Map([
    [DOZER_PICTURE, DOZER],
    [LOADER_PICTURE, LOADER],
    [GRADER_PICTURE, GRADER],
    [TOW_PICTURE, TOW_TRUCK],
  ]),
  enter,
  finished,
  speechSkipped,
  worked,
  dumped,
  vehicleClick,
  vehicleMoved,
  axisLock,
  picturePicked,
  pictureReturned,
  itemDropped,
  semiArrived,
  semiLeft,
  click,
  idle,
});
