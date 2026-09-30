import { ACTIVITY_QUARRY } from "../../engine/progress";
import { createOutdoorLogic, type Outdoor } from "./outdoor";

const LOADER = 0;
const CRANE = 1;
const DOZER = 3;
const BLACK_PILE = 5;
const RED_PILE = 6;
const WALLS = [7, 8, 9, 10];
const CAVE_PILE = 11;
const SKELETON = 12;
const OIL = 13;
const BATS = 14;
const CRUSHER_OUTPUT = 15;
const HOPPER = 16;
const INTRO = 17;
const CRANE_SPOT = 19;
const OIL_CARTOON = 22;
const SKELETON_CARTOON = 23;
const AFTER_BATS = 24;
const GOLD_VEINS = [25, 26, 27, 28];
const DOZER_MARKER = 33;
const BOULDERS = [34, 40, 41, 63, 64];
const TRAILER_GUY = 35;
const ROCK_SLIDE = 36;
const SECOND_CAVE_PILE = 37;
const DRAG_LIMIT_ROCK = 38;
const FENCE = 42;
const GOLD_FOUND = 44;
const TRAILER_COMMENT = 45;
const QUARRY_COMPLETE = 46;
const POST_COMPLETION = 47;
const GOLD_CELEBRATION = 65;
const TASK_NARRATION = 66;
const TASK_CARD = 67;
const IDLE_HINTS = [76, 77, 78, 79, 80, 81];
const REVISIT_INCOMPLETE = 82;
const REVISIT_COMPLETE = 83;
const DOZER_ARRIVES = 84;
const LOADER_ARRIVES = 85;
const SECOND_INTRO = 86;
const NO_GOLD_FIRST = 87;
const PUFF = 89;
const BAY = { left: 635, top: 372, right: 728, bottom: 480 };
const PARK_X = 660;
const PARK_Y = 400;
const PARK_HEADING = 6;
const PATH_MS = 40;
const HOPPER_TIMER_ID = 0x387;
const HOPPER_STEP_MS = 300;
const HOPPER_STEPS = 12;
const BUCKET_ENTRY = 0xe0;
const CONVEYOR_ENTRY = 0xe8;
const HELP_FIRST = 50;
const HELP_LAST = 60;

const MATERIALS = new Map<number, number[]>([
  [BLACK_PILE, [0x2d, 0x29, 0x2b, 0x8e]],
  [RED_PILE, [0x81, 0x82, 0x76, 0x71]],
]);
const BROWN = [0x53, 0x55, 0x5a, 0x6a];
const GOLD = [0x0a, 0x0b, 0x0c, 0x0d];

function isDone(outdoor: Outdoor): boolean {
  return outdoor.engine.progress.done[ACTIVITY_QUARRY];
}

function materialFor(target: number): number[] {
  if (GOLD_VEINS.includes(target)) {
    return GOLD;
  }

  return MATERIALS.get(target) ?? BROWN;
}

function isInside(x: number, y: number): boolean {
  return x > BAY.left && x < BAY.right && y > BAY.top && y < BAY.bottom;
}

function enter(outdoor: Outdoor): number | undefined {
  const intro = outdoor.scene.objects[INTRO];
  const previous = outdoor.engine.previousModule;
  const cameFromHelp = previous >= HELP_FIRST && previous <= HELP_LAST;

  if (!intro.finished || cameFromHelp) {
    return undefined;
  }

  const revisit = isDone(outdoor) ? REVISIT_COMPLETE : REVISIT_INCOMPLETE;

  outdoor.scene.objects[revisit].finished = false;

  return revisit;
}

function nextVehicle(outdoor: Outdoor): number {
  return outdoor.state.currentVehicle === LOADER ? DOZER : LOADER;
}

function driveIn(outdoor: Outdoor, vehicle: number): void {
  const scene = outdoor.scene;
  const object = scene.objects[vehicle];

  outdoor.state.currentVehicle = vehicle;
  scene.moveTo(vehicle, object.def.x, object.def.y);
  scene.setVisible(vehicle, true);
  outdoor.sfx(6);
  outdoor.engine.pushAmbient("sfx2.wav");
  outdoor.lock();
  outdoor.engine
    .runPath(vehicle, "path11.bin", PATH_MS, () => vehicleArrived(outdoor, vehicle))
    .catch(() => undefined);
}

function vehicleArrived(outdoor: Outdoor, vehicle: number): void {
  const line = vehicle === LOADER ? LOADER_ARRIVES : DOZER_ARRIVES;

  outdoor.unlock();
  outdoor.setFlag("vehicleOut");
  outdoor.sfx(7);
  outdoor.say(line);
}

async function playDriveOutSounds(outdoor: Outdoor): Promise<void> {
  const start = await outdoor.engine.audio.playWav("sfx7.wav");

  await start.ended;
  outdoor.sfx(3);
}

function driveOut(outdoor: Outdoor, vehicle: number): void {
  playDriveOutSounds(outdoor).catch(() => undefined);
  outdoor.engine.popAmbient();
  outdoor.lock();
  outdoor.engine
    .runPath(vehicle, "path12.bin", PATH_MS, () => vehicleLeft(outdoor, vehicle))
    .catch(() => undefined);
}

function vehicleLeft(outdoor: Outdoor, vehicle: number): void {
  const scene = outdoor.scene;
  const object = scene.objects[vehicle];

  outdoor.unlock();
  outdoor.setFlag("vehicleOut", false);
  outdoor.state.toolDown = false;
  scene.moveTo(vehicle, object.def.x, object.def.y);
  outdoor.hide(vehicle);

  if (vehicle === DOZER) {
    outdoor.hide(DOZER_MARKER);
  }

  if (!outdoor.engine.speechBusy) {
    outdoor.engine.armIdle();
  }
}

function worldClick(outdoor: Outdoor, x: number, y: number): boolean {
  if (outdoor.flag("hopperBusy")) {
    return true;
  }

  const hit = outdoor.scene.hitTest(x, y);
  const isEmptyBay = hit === undefined && isInside(x, y);

  if (!isEmptyBay) {
    return false;
  }

  if (outdoor.flag("vehicleOut")) {
    driveOut(outdoor, outdoor.state.currentVehicle);
  } else {
    driveIn(outdoor, nextVehicle(outdoor));
  }

  return true;
}

function vehicleClick(outdoor: Outdoor, vehicle: number): boolean {
  const scene = outdoor.scene;
  const object = scene.objects[vehicle];

  if (outdoor.flag("hopperBusy")) {
    return true;
  }

  if (!isInside(object.x, object.y)) {
    return false;
  }

  scene.moveTo(vehicle, PARK_X, PARK_Y);
  scene.setPose(vehicle, PARK_HEADING, object.loadSet, 0);
  outdoor.engine.release();
  driveOut(outdoor, vehicle);

  return true;
}

function colourBucket(outdoor: Outdoor, target: number): void {
  const material = materialFor(target);

  material.forEach((source, offset) => {
    outdoor.engine.copyPaletteEntry(BUCKET_ENTRY + offset, source);
  });

  outdoor.setFlag("carryingGold", GOLD_VEINS.includes(target));
}

function scooped(outdoor: Outdoor, target: number): void {
  outdoor.sfx(5);
  colourBucket(outdoor, target);
}

function comment(
  outdoor: Outdoor,
  step: number,
  stillVisible: boolean,
  firstChance: number,
  first: number,
  count: number,
): void {
  const firstStep = step === 1 && outdoor.chance(firstChance);
  const secondStep = step === 2 && stillVisible && outdoor.chance(70);

  if (firstStep || secondStep) {
    outdoor.say(outdoor.pick(first, count));
  }
}

function worked(outdoor: Outdoor, target: number): void {
  const object = outdoor.scene.objects[target];
  const step = object.step;
  const isPile = target === BLACK_PILE || target === RED_PILE;

  if (isPile) {
    comment(outdoor, step, object.visible, 30, 56, 5);
    return;
  }

  if (WALLS.includes(target)) {
    comment(outdoor, step, object.visible, 40, 52, 4);
  }
}

function startHopper(outdoor: Outdoor): void {
  const steps = Array.from({ length: HOPPER_STEPS }, (_, step) => step).values();

  outdoor.setFlag("hopperBusy");
  outdoor.engine.timers.add(
    HOPPER_TIMER_ID,
    HOPPER_STEP_MS,
    () => {
      const next = steps.next();

      if (next.done) {
        outdoor.engine.timers.remove(HOPPER_TIMER_ID);
        outdoor.setFlag("hopperBusy", false);
        hopperFinished(outdoor);
        return;
      }

      const step = next.value;
      const source = BUCKET_ENTRY + (step % 4);

      outdoor.engine.copyPaletteEntry(CONVEYOR_ENTRY + step, source);
    },
    0,
  );
}

function hopperFinished(outdoor: Outdoor): void {
  if (!outdoor.flag("hopperGold")) {
    return;
  }

  outdoor.setFlag("hopperGold", false);
  outdoor.setLayer(CRUSHER_OUTPUT, 0);
  outdoor.lock();
  outdoor.say(GOLD_CELEBRATION);
}

function dumped(outdoor: Outdoor, vehicle: number, under: number | undefined): boolean {
  const intoHopper = under === HOPPER && vehicle === LOADER && !outdoor.flag("hopperBusy");

  if (intoHopper) {
    outdoor.setFlag("hopperGold", outdoor.flag("carryingGold"));
    startHopper(outdoor);
  }

  outdoor.setFlag("carryingGold", false);

  return false;
}

function liftBoulder(outdoor: Outdoor, boulder: number): void {
  outdoor.hide(boulder);
  outdoor.setLayer(HOPPER, 0);
  outdoor.rewind(CRANE);
  outdoor.say(CRANE);
}

function bump(outdoor: Outdoor, target: number, mover: number): boolean {
  const isFence =
    target === FENCE &&
    outdoor.scene.isVehicle(mover) &&
    !outdoor.scene.objects[TRAILER_GUY].playing;
  const isBoulderOnSpot =
    target === CRANE_SPOT && BOULDERS.includes(mover) && !outdoor.scene.objects[CRANE].playing;

  if (isFence) {
    outdoor.say(TRAILER_GUY);
    return true;
  }

  if (isBoulderOnSpot) {
    liftBoulder(outdoor, mover);
    return true;
  }

  return false;
}

function rollForGold(outdoor: Outdoor, wall: number): void {
  const firstWall = WALLS[0];

  outdoor.setFlag(`wall${firstWall}`);
  outdoor.setFlag(`wall${wall}`);

  const wallsDug = WALLS.filter((index) => outdoor.flag(`wall${index}`)).length;
  const foundGold = !outdoor.flag("goldFound") && outdoor.chance(25 * wallsDug);

  if (foundGold) {
    outdoor.setFlag("goldFound");
    outdoor.show(wall + 18);
    outdoor.say(GOLD_FOUND);
    return;
  }

  if (!isDone(outdoor)) {
    const clip = outdoor.pick(NO_GOLD_FIRST, 2);

    outdoor.rewind(clip);
    outdoor.say(clip);
  }
}

function completeIfReady(outdoor: Outdoor, otherPile: number): void {
  if (outdoor.flag("goldScooped") && !outdoor.visible(otherPile)) {
    outdoor.say(QUARRY_COMPLETE);
  }
}

function craneFinished(outdoor: Outdoor): void {
  outdoor.prime(CRANE);
  outdoor.setLayer(CRANE, 1);
  outdoor.scene.objects[CRANE].finished = false;
  outdoor.setLayer(HOPPER, 1);

  if (outdoor.chance(50)) {
    outdoor.say(outdoor.pick(61, 2));
  }
}

function startDriving(outdoor: Outdoor): void {
  outdoor.hide(TASK_CARD);
  driveIn(outdoor, LOADER);
  outdoor.engine.setPaletteCycling(true);
}

function goldVeinScooped(outdoor: Outdoor): void {
  outdoor.setFlag("goldScooped");

  if (!outdoor.visible(BLACK_PILE) && !outdoor.visible(RED_PILE)) {
    outdoor.say(QUARRY_COMPLETE);
  }
}

function finishedSteps(outdoor: Outdoor): Map<number, () => void> {
  return new Map<number, () => void>([
    [CRANE, () => craneFinished(outdoor)],
    [BLACK_PILE, () => outdoor.say(SKELETON_CARTOON)],
    [RED_PILE, () => outdoor.say(OIL)],
    [CAVE_PILE, () => outdoor.say(ROCK_SLIDE)],
    [SKELETON, () => completeIfReady(outdoor, RED_PILE)],
    [
      OIL,
      () => {
        outdoor.setLayer(OIL, 0);
        outdoor.say(OIL_CARTOON);
      },
    ],
    [BATS, () => outdoor.say(AFTER_BATS)],
    [
      INTRO,
      () => {
        outdoor.show(TASK_CARD);
        outdoor.hide(INTRO);
        outdoor.say(TASK_NARRATION);
      },
    ],
    [OIL_CARTOON, () => completeIfReady(outdoor, BLACK_PILE)],
    [SKELETON_CARTOON, () => outdoor.say(SKELETON)],
    [
      TRAILER_GUY,
      () => {
        if (outdoor.chance(30)) {
          outdoor.rewind(TRAILER_COMMENT);
          outdoor.say(TRAILER_COMMENT);
        }
      },
    ],
    [SECOND_CAVE_PILE, () => outdoor.say(BATS)],
    [
      QUARRY_COMPLETE,
      () => {
        outdoor.complete(ACTIVITY_QUARRY);
        outdoor.say(POST_COMPLETION);
      },
    ],
    [
      GOLD_CELEBRATION,
      () => {
        outdoor.setLayer(CRUSHER_OUTPUT, 1);
        outdoor.unlock();
      },
    ],
    [
      TASK_NARRATION,
      () => {
        outdoor.prime(SECOND_INTRO);
        outdoor.hide(TASK_CARD);
        outdoor.say(SECOND_INTRO);
      },
    ],
    [SECOND_INTRO, () => startDriving(outdoor)],
  ]);
}

function finished(outdoor: Outdoor, object: number): void {
  if (WALLS.includes(object)) {
    rollForGold(outdoor, object);
    return;
  }

  if (GOLD_VEINS.includes(object)) {
    goldVeinScooped(outdoor);
    return;
  }

  finishedSteps(outdoor).get(object)?.();
}

function speechSkipped(outdoor: Outdoor, object: number): boolean {
  const isIntroPart = [INTRO, TASK_NARRATION, SECOND_INTRO].includes(object);

  if (!isIntroPart) {
    return false;
  }

  outdoor.hide(object, TASK_CARD);
  startDriving(outdoor);

  return true;
}

function itemPicked(outdoor: Outdoor, item: number): void {
  if (item === DOZER) {
    outdoor.show(DOZER_MARKER);
  }
}

function dragItem(outdoor: Outdoor, item: number, x: number, y: number): boolean {
  const scene = outdoor.scene;
  const rock = scene.objects[DRAG_LIMIT_ROCK];
  const itemImage = scene.objects[item].image;
  const rockImage = rock.image;

  if (!itemImage || !rockImage) {
    return true;
  }

  const itemLeft = x - (itemImage.width >> 1);
  const itemTop = y - (itemImage.height >> 1);
  const rockLeft = rock.x - (rockImage.width >> 1);
  const rockTop = rock.y - (rockImage.height >> 1);
  const rockRight = itemLeft + rockImage.width;
  const rockBottom = itemTop + rockImage.height;
  const overlapsX = rockLeft < itemLeft + itemImage.width && itemLeft < rockRight;
  const overlapsY = rockTop < itemTop + itemImage.height && itemTop < rockBottom;

  return !(overlapsX && overlapsY);
}

function idle(outdoor: Outdoor): void {
  if (isDone(outdoor)) {
    return;
  }

  outdoor.say(outdoor.pickIdle(IDLE_HINTS));
}

export const quarry = createOutdoorLogic({
  moduleNumber: 1,
  puffAnimation: PUFF,
  enter,
  finished,
  speechSkipped,
  bump,
  worked,
  scooped,
  dumped,
  vehicleClick,
  worldClick,
  itemPicked,
  dragItem,
  idle,
});
