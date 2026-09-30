import { ACTIVITY_CASTLE } from "../../engine/progress";
import { createSiteLogic, type Site } from "./site";

const EXCAVATOR = 0;
const CRANE = 1;
const MIXER = 2;
const GROUNDS_OVERLAY = 5;
const HEAPS = [7, 8, 9, 10];
const STRINGS = [11, 12, 13, 14];
const FIRST_SURVEYOR = 15;
const LAST_SURVEYOR = 19;
const STAKE_OFFSET = 68;
const TOWER_CHAIN = 26;
const WALL_CHAIN = 34;
const WALL_ITEMS = [34, 37, 40, 43];
const WALL_STATICS = [33, 36, 39, 42];
const WALL_SETTLES = [35, 38, 41, 44];
const CEMENT_POUR = 46;
const CEMENT_SMOOTH = 47;
const UPPER_CHAIN = 49;
const UPPER_ANIMATIONS = [52, 55, 58];
const ROOF_ANIMATION = 59;
const ROOF = 60;
const GATE_LEFT_STATIC = 64;
const GATE_LEFT = 65;
const GATE_RIGHT_STATIC = 66;
const GATE_RIGHT = 67;
const GATE_FINALE = 68;
const FINALE_TWO = 70;
const FLAG_CHAIN = 72;
const FLAG_CHAIN_PARTNER = 71;
const FLAG_EXTRA = 73;
const GATE = 80;
const ROOF_KEEP = 81;
const GUIDE = 87;
const FINALE_THREE = 88;
const FINALE_FOUR = 89;
const CRANE_QUIPS = [93, 94, 95];
const EXCAVATOR_JOB = 97;
const HEAPS_DUG = 98;
const RUSTY_COMPLETION = 102;
const REVISIT_INCOMPLETE = 104;
const REVISIT_COMPLETE = 105;
const COMPLETION_LINE = 106;
const BOARD_VOICE = 107;
const INTRO = 108;
const INTRO_PART_TWO = 109;
const TASK_BOARD = 110;
const GUIDE_LEAVES = 111;
const SECOND_GUIDE = 112;
const GUIDE_VANISHES = 113;
const CRANE_JOB = 114;
const MIXER_NOT_NEEDED = 115;
const EXCAVATOR_NOT_NEEDED = 116;
const MIXER_JOB = 118;
const BONUS_CHAIN = 128;
const IDLE_HINT = 138;
const COMPOSITE = 140;
const CASTLE_DONE_LINE = 141;
const CRANE_NEEDED = 142;
const DROP_MARKER = 144;
const MIXER_MARKER = 145;
const DUMP_ANIMATION = 147;
const CRANE_CALL_HEIGHT = 300;
const POUR_BOX = { left: 211, right: 340, top: 302, bottom: 427 };
const POUR_X = 237;
const POUR_Y = 366;
const POUR_HEADING = 7;
const HELP_FIRST = 50;
const HELP_LAST = 60;

const GUIDE_SPOTS = new Map<number, [number, number]>([
  [26, [254, 127]],
  [28, [483, 152]],
  [30, [134, 271]],
  [32, [365, 370]],
  [34, [254, 127]],
  [37, [483, 152]],
  [40, [134, 271]],
  [43, [365, 370]],
  [49, [347, 118]],
  [51, [483, 152]],
  [54, [238, 102]],
  [57, [529, 290]],
]);
const TOWER_ITEMS = [26, 28, 30, 32];
const FLAG_ITEMS = [72, 75, 77, 79, 121, 123, 125, 127];
const WORKER_STRINGS = new Map<number, [number, number]>([
  [20, [83, 11]],
  [21, [84, 13]],
  [22, [85, 14]],
]);

function isDone(site: Site): boolean {
  return site.engine.progress.done[ACTIVITY_CASTLE];
}

function wallsUp(site: Site): boolean {
  return site.allVisible(WALL_STATICS);
}

function enter(site: Site): number | undefined {
  const intro = site.scene.objects[INTRO];
  const previous = site.engine.previousModule;
  const cameFromHelp = previous >= HELP_FIRST && previous <= HELP_LAST;

  if (!intro.finished || cameFromHelp) {
    return undefined;
  }

  const revisit = isDone(site) ? REVISIT_COMPLETE : REVISIT_INCOMPLETE;

  site.scene.objects[revisit].finished = false;

  return revisit;
}

function skipIntro(site: Site, object: number): boolean {
  const isIntroPart = [BOARD_VOICE, INTRO, INTRO_PART_TWO].includes(object);

  if (!isIntroPart) {
    return false;
  }

  site.hide(object, TASK_BOARD, INTRO);
  site.say(FIRST_SURVEYOR);

  return true;
}

function guideLeaves(site: Site, guide: number, leave: number, dx: number, dy: number): void {
  const object = site.scene.objects[guide];
  const x = object.x + dx;
  const y = object.y + dy;

  site.hide(guide);
  site.playAt(leave, x, y);
}

function sendGuideAway(site: Site): void {
  guideLeaves(site, GUIDE, GUIDE_LEAVES, -3, -27);
}

function introStep(site: Site, object: number): boolean {
  const steps = new Map<number, () => void>([
    [
      INTRO,
      () => {
        site.show(TASK_BOARD);
        site.say(BOARD_VOICE);
      },
    ],
    [
      BOARD_VOICE,
      () => {
        site.prime(INTRO_PART_TWO);
        site.hide(TASK_BOARD, INTRO);
        site.say(INTRO_PART_TWO);
      },
    ],
    [INTRO_PART_TWO, () => site.say(FIRST_SURVEYOR)],
    [
      23,
      () => {
        site.hide(86, 12, 23);
        site.say(24);
      },
    ],
    [
      24,
      () => {
        site.callVehicle();
        site.flashArrows();
      },
    ],
  ]);
  const step = steps.get(object);

  step?.();

  return step !== undefined;
}

function surveyStep(site: Site, object: number): boolean {
  const isSurveyor = object >= FIRST_SURVEYOR && object < LAST_SURVEYOR;

  if (object === LAST_SURVEYOR) {
    site.engine.play(20, 2, false);
    return true;
  }

  if (!isSurveyor) {
    return false;
  }

  site.show(object + STAKE_OFFSET);
  site.hide(object);
  site.say(object + 1);

  return true;
}

function buildStep(site: Site, object: number): boolean {
  const steps = new Map<number, () => void>([
    [
      CEMENT_POUR,
      () => {
        site.engine.inputLocked = false;
        site.say(CEMENT_SMOOTH);
        site.flashArrows();
      },
    ],
    [CEMENT_SMOOTH, () => site.hide(MIXER_MARKER)],
    [
      ROOF_ANIMATION,
      () => {
        site.show(ROOF_KEEP);
        site.bringFlatbed(GATE_LEFT);
      },
    ],
    [
      SECOND_GUIDE,
      () => {
        guideLeaves(site, SECOND_GUIDE, GUIDE_VANISHES, 1, 1);
      },
    ],
  ]);
  const step = steps.get(object);

  step?.();

  return step !== undefined;
}

function finaleStep(site: Site, object: number): boolean {
  const steps = new Map<number, () => void>([
    [
      GATE_FINALE,
      () => {
        site.hide(GATE_FINALE);
        site.show(GATE);
        site.engine.inputLocked = true;
        site.say(FINALE_TWO);
      },
    ],
    [
      FINALE_TWO,
      () => {
        site.setLayer(FINALE_TWO, 0);
        site.say(FINALE_THREE);
      },
    ],
    [
      FINALE_THREE,
      () => {
        site.setLayer(FINALE_THREE, 0);
        site.say(FINALE_FOUR);
      },
    ],
    [
      FINALE_FOUR,
      () => {
        site.engine.inputLocked = false;
        site.hide(GUIDE);
        site.flashArrows();
      },
    ],
    [CASTLE_DONE_LINE, () => site.bringFlatbed(FLAG_CHAIN, true)],
    [
      RUSTY_COMPLETION,
      () => {
        site.complete(ACTIVITY_CASTLE);
        site.say(COMPLETION_LINE);
      },
    ],
  ]);
  const step = steps.get(object);

  step?.();

  return step !== undefined;
}

function settleFinished(site: Site, object: number): boolean {
  if (!WALL_SETTLES.includes(object)) {
    return false;
  }

  if (site.visible(GUIDE)) {
    sendGuideAway(site);
  }

  if (wallsUp(site)) {
    site.flashArrows();
  }

  return true;
}

function upperFinished(site: Site, object: number): boolean {
  if (!UPPER_ANIMATIONS.includes(object)) {
    return false;
  }

  if (site.visible(GUIDE)) {
    sendGuideAway(site);
    return true;
  }

  site.bringFlatbed(ROOF);

  return true;
}

function finished(site: Site, object: number): void {
  const handlers = [introStep, surveyStep, buildStep, finaleStep, settleFinished, upperFinished];

  handlers.some((handler) => handler(site, object));
}

function click(site: Site, object: number): void {
  const reveals = WORKER_STRINGS.get(object);

  if (!reveals) {
    return;
  }

  site.hide(reveals[0], reveals[1], object);
  site.engine.play(object + 1, 2, object + 1 === 23);
}

function vehicleArrived(site: Site, vehicle: number): void {
  site.engine.audio.playWav("sfx7.wav").catch(() => undefined);

  if (vehicle === EXCAVATOR) {
    site.say(site.allHidden(HEAPS) ? EXCAVATOR_NOT_NEEDED : EXCAVATOR_JOB);
    return;
  }

  if (vehicle === CRANE) {
    const gateMissing = !site.visible(GATE_LEFT_STATIC) || !site.visible(GATE_RIGHT_STATIC);

    site.say(gateMissing && site.visible(CEMENT_POUR) ? CRANE_NEEDED : CRANE_JOB);
    return;
  }

  const needsCement = wallsUp(site) && !site.flag("cementPoured");

  site.say(needsCement ? MIXER_JOB : MIXER_NOT_NEEDED);
}

function vehicleLeft(site: Site, vehicle: number): void {
  site.hide(vehicle);

  if (vehicle === MIXER) {
    site.hide(MIXER_MARKER);
    return;
  }

  const gateUp = site.allVisible([GATE_LEFT_STATIC, GATE_RIGHT_STATIC]);
  const startsFinale = vehicle === CRANE && gateUp && !site.flag("craneFinale");

  if (!startsFinale) {
    return;
  }

  site.setFlag("craneFinale");
  site.setLayer(FINALE_FOUR, 0);
  site.show(GROUNDS_OVERLAY);
  site.say(CASTLE_DONE_LINE);
  site.flashArrows();
}

function callDelivery(site: Site, flag: string, chain: number): void {
  if (site.flag(flag)) {
    return;
  }

  site.setFlag(flag);
  site.bringFlatbed(chain);
}

function vehicleMoved(site: Site, vehicle: number): void {
  const object = site.scene.objects[vehicle];
  const isHighCrane = vehicle === CRANE && object.y < CRANE_CALL_HEIGHT;

  if (!isHighCrane) {
    return;
  }

  if (site.allHidden(HEAPS)) {
    callDelivery(site, "towersCalled", TOWER_CHAIN);
  }

  if (site.visible(CEMENT_POUR)) {
    callDelivery(site, "upperCalled", UPPER_CHAIN);
  }
}

function showDropMarker(site: Site, item: number): void {
  const scene = site.scene;
  const def = scene.objects[item].def;
  const targetX = def.raw.getInt16(0x7c, true);
  const targetY = def.raw.getInt16(0x7e, true);
  const markerHeight = scene.objects[DROP_MARKER].image?.height ?? 0;

  scene.moveTo(DROP_MARKER, targetX, targetY - (markerHeight >> 1));
  site.show(DROP_MARKER);
}

function craneEmptiedFlatbed(site: Site): boolean {
  const scene = site.scene;
  const craneHeld = scene.heldObject === CRANE;
  const flatbedEmpty = scene.objects[site.script.flatbed].link < 1;

  return craneHeld && flatbedEmpty && !site.state.semiPresent;
}

function itemPicked(site: Site, item: number): void {
  const guideSpot = GUIDE_SPOTS.get(item);
  const skipsPickup = craneEmptiedFlatbed(site);

  if (skipsPickup) {
    return;
  }

  if (guideSpot) {
    site.playAt(GUIDE, guideSpot[0], guideSpot[1]);
    return;
  }

  if (item === MIXER && wallsUp(site) && !site.flag("cementPoured")) {
    site.show(MIXER_MARKER);
    return;
  }

  if (FLAG_ITEMS.includes(item)) {
    showDropMarker(site, item);
    return;
  }

  pickGatePiece(site, item);
}

function pickGatePiece(site: Site, item: number): void {
  if (item === GATE_LEFT && !site.visible(GATE_RIGHT_STATIC)) {
    site.playAt(SECOND_GUIDE, 232, 309);
  }

  if (item === GATE_RIGHT && !site.visible(GATE_LEFT_STATIC)) {
    site.playAt(SECOND_GUIDE, 365, 370);
  }
}

function dropTower(site: Site, item: number): void {
  site.activatePartner(item);

  if (site.visible(GUIDE)) {
    sendGuideAway(site);
    return;
  }

  callDelivery(site, "wallsCalled", WALL_CHAIN);
}

function dropUpper(site: Site, item: number): void {
  site.activatePartner(item);

  if (item === 54 || item === 57) {
    site.engine.play(item + 1, 2, true);
    return;
  }

  if (site.allVisible([48, 50])) {
    site.engine.play(52, 2, true);
    return;
  }

  sendGuideAway(site);
}

function dropFlag(site: Site, item: number): void {
  site.hide(DROP_MARKER);

  if (item === FLAG_CHAIN) {
    site.hide(item);
    site.show(FLAG_EXTRA);
    site.engine.play(FLAG_CHAIN_PARTNER, 2, false);
    return;
  }

  site.activatePartner(item);
}

function dropGate(site: Site, item: number): void {
  site.activatePartner(item);

  if (site.allVisible([GATE_LEFT_STATIC, GATE_RIGHT_STATIC])) {
    site.say(GATE_FINALE);
  }
}

function dropped(site: Site, item: number): boolean {
  const handlers = new Map<number, (target: Site, placed: number) => void>();

  for (const tower of TOWER_ITEMS) {
    handlers.set(tower, dropTower);
  }

  for (const wall of WALL_ITEMS) {
    handlers.set(wall, (target, placed) => {
      target.activatePartner(placed);
      target.engine.play(placed + 1, 2, false);
    });
  }

  for (const upper of [49, 51, 54, 57]) {
    handlers.set(upper, dropUpper);
  }

  for (const flagItem of FLAG_ITEMS) {
    handlers.set(flagItem, dropFlag);
  }

  handlers.set(GATE_LEFT, dropGate);
  handlers.set(GATE_RIGHT, dropGate);

  const handler = handlers.get(item);

  if (!handler) {
    return false;
  }

  handler(site, item);

  return true;
}

function semiArrived(site: Site): void {
  site.engine.audio.playWav("sfx7.wav").catch(() => undefined);

  if (!site.flatbedCarries(FLAG_CHAIN) || isDone(site)) {
    return;
  }

  for (let index = 25; index <= 69; index += 1) {
    site.hide(index);
  }

  site.hide(GATE, ROOF_KEEP);
  site.show(COMPOSITE);
  site.say(RUSTY_COMPLETION);
}

function semiLeft(site: Site): void {
  const craneHoldsRoof = site.scene.objects[CRANE].link === ROOF;

  if (craneHoldsRoof) {
    site.engine.stopStream(SECOND_GUIDE, "rewind");
    site.playAt(SECOND_GUIDE, 323, 330);
    return;
  }

  if (isDone(site) && !site.flag("bonusDelivered")) {
    site.setFlag("bonusDelivered");
    site.bringFlatbed(BONUS_CHAIN);
  }
}

function workClick(site: Site, vehicle: number): boolean {
  const object = site.scene.objects[vehicle];
  const inBox =
    object.x >= POUR_BOX.left &&
    object.x <= POUR_BOX.right &&
    object.y >= POUR_BOX.top &&
    object.y <= POUR_BOX.bottom;
  const canPour = vehicle === MIXER && inBox && wallsUp(site) && !site.flag("cementPoured");

  if (!canPour) {
    return false;
  }

  site.scene.moveTo(MIXER, POUR_X, POUR_Y);
  site.scene.setPose(MIXER, POUR_HEADING, 0, 0);
  site.setFlag("cementPoured");
  site.engine.inputLocked = true;
  site.say(CEMENT_POUR);

  return true;
}

function scooped(site: Site): void {
  site.engine.audio.playWav("sfx5.wav").catch(() => undefined);

  if (site.allHidden(HEAPS)) {
    site.say(HEAPS_DUG);
    site.flashArrows();
  }
}

function idle(site: Site): void {
  if (!isDone(site)) {
    site.say(IDLE_HINT);
  }
}

const DELIVERY_CHAINS = [
  [26, 28, 30, 32],
  [34, 37, 40, 43],
  [49, 51, 54, 57],
  [65, 67],
  [72, 75, 77, 79, 121, 123],
  [128, 129, 130, 131, 132, 133],
];

export const castle = createSiteLogic({
  moduleNumber: 5,
  chains: DELIVERY_CHAINS,
  flatbed: 3,
  crane: CRANE,
  dumpAnimation: DUMP_ANIMATION,
  craneQuips: CRANE_QUIPS,
  acceptsAnyDrop: false,
  enter,
  finished,
  speechSkipped: skipIntro,
  vehicleArrived,
  vehicleLeft,
  semiArrived,
  semiLeft,
  vehicleMoved,
  itemPicked,
  dropped,
  scooped,
  workClick,
  click,
  idle,
  refusesVehicleCall: (site) => !site.allHidden(STRINGS),
});
