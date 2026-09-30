import { ACTIVITY_DESERT } from "../../engine/progress";
import { isNearTarget, targetOf } from "../shared/tool";
import { createOutdoorLogic, type Outdoor } from "./outdoor";

const LOADER = 0;
const LOADER_PICTURE = 1;
const GRADER = 2;
const GRADER_PICTURE = 3;
const TANKER = 4;
const TANKER_PICTURE = 5;
const PAVER = 6;
const PAVER_PICTURE = 7;
const ROLLER = 8;
const ROLLER_PICTURE = 9;
const DOZER = 10;
const DOZER_PICTURE = 11;
const HELICOPTER = 12;
const HELICOPTER_PICTURE = 13;
const SEMI = 14;
const TANKER_LAYER_FIRST = 18;
const TANKER_LAYER_LAST = 25;
const ROAD_CHECK_LAST = 44;
const TUNNEL_FIRST = 158;
const TUNNEL_LAST = 174;
const SPAN_A = 178;
const BRIDGE_CHAIN = 179;
const SPAN_B = 180;
const ROAD_REVEAL = 182;
const CAR_DRIVES_THROUGH = 184;
const BILLBOARD_INSTALLED = 185;
const BILLBOARD = 186;
const DECORATIONS = [186, 188, 190, 192, 194];
const DECORATION_CLIPS = [187, 189, 191, 193];
const ROCKS = [199, 200, 201, 202, 203, 204, 205, 206];
const INTRO = 207;
const COWBOY_INTRO = 208;
const TUNNEL_CLIP = 210;
const ROAD_DONE_LINE = 211;
const SIGNS_ARRIVED = 212;
const COMPLETE_CLIP = 225;
const BILLBOARD_CAR = 226;
const BILLBOARD_CAR_LEAVES = 227;
const TASK_NARRATION = 231;
const TASK_CARD = 232;
const COMPLETION_LINE = 237;
const DECORATIONS_ARRIVED = 251;
const REVISIT_INCOMPLETE = 252;
const REVISIT_COMPLETE = 253;
const TUNNEL_OPEN = 254;
const SIGN_CHAIN = 255;
const NOT_FINISHED = 264;
const BRIDGE_DONE = 266;
const ARROW = 269;
const PUFF = 270;
const LIMIT_X = 1415;
const DOZER_LIMIT_X = 855;
const LIMITED_VEHICLES = [LOADER, GRADER, TANKER, PAVER, ROLLER];
const FINAL_SCROLL = 1266;
const HELP_FIRST = 50;
const HELP_LAST = 60;
const UNLOCKING_CLIPS = [239, 240, 241, 242, 243, 244, 267, 268];

const PICTURE_HINTS = new Map<number, number>([
  [DOZER_PICTURE, 239],
  [GRADER_PICTURE, 240],
  [PAVER_PICTURE, 241],
  [TANKER_PICTURE, 242],
  [ROLLER_PICTURE, 243],
  [HELICOPTER_PICTURE, 244],
]);

const PICTURE_LAYERS = new Map<number, [number, number]>([
  [LOADER_PICTURE, [TUNNEL_FIRST, TUNNEL_LAST]],
  [GRADER_PICTURE, [114, 157]],
  [TANKER_PICTURE, [TANKER_LAYER_FIRST, TANKER_LAYER_LAST]],
  [PAVER_PICTURE, [70, 113]],
  [ROLLER_PICTURE, [26, 69]],
]);

const DELIVERY_CHAINS = [
  [BRIDGE_CHAIN, 181],
  [BILLBOARD, 188, 190, 192],
  [SIGN_CHAIN, 256, 257, 258, 259, 260],
];

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

function isDone(outdoor: Outdoor): boolean {
  return outdoor.engine.progress.done[ACTIVITY_DESERT];
}

function linkChain(outdoor: Outdoor, members: number[]): void {
  const objects = outdoor.scene.objects;

  members.forEach((member, position) => {
    const next = members[position + 1] ?? -1;
    const previous = members[position - 1] ?? SEMI;

    objects[member].link = next;
    objects[member].carrier = previous;
  });
}

function buildChains(outdoor: Outdoor): void {
  if (outdoor.flag("chainsBuilt")) {
    return;
  }

  outdoor.setFlag("chainsBuilt");

  for (const chain of DELIVERY_CHAINS) {
    linkChain(outdoor, chain);
  }
}

function enter(outdoor: Outdoor): number | undefined {
  buildChains(outdoor);

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

function rightEdge(outdoor: Outdoor, index: number): number {
  const object = outdoor.scene.objects[index];
  const halfWidth = (object.image?.width ?? 0) >> 1;

  return object.x + halfWidth;
}

function axisLock(outdoor: Outdoor, vehicle: number, dx: number): number {
  const edge = rightEdge(outdoor, vehicle) + dx;
  const isLimited = LIMITED_VEHICLES.includes(vehicle) && edge >= LIMIT_X;
  const isDozerLimited = vehicle === DOZER && edge >= DOZER_LIMIT_X;

  if (isLimited || isDozerLimited) {
    return 0;
  }

  return dx;
}

function bump(outdoor: Outdoor, target: number, mover: number): boolean {
  const isRockPastLimit =
    mover === DOZER && ROCKS.includes(target) && rightEdge(outdoor, target) > DOZER_LIMIT_X;

  if (isRockPastLimit) {
    outdoor.hide(target);
    return true;
  }

  return false;
}

function worked(outdoor: Outdoor, target: number): void {
  const isTunnelRock = target >= TUNNEL_FIRST && target <= TUNNEL_LAST;

  if (isTunnelRock) {
    outdoor.sfx(5);
  }
}

function picturePicked(outdoor: Outdoor, picture: number): void {
  const firstTime = outdoor.engine.progress.timesCompleted[ACTIVITY_DESERT] === 0;
  const loaderHint = firstTime ? 268 : 267;
  const hint = picture === LOADER_PICTURE ? loaderHint : PICTURE_HINTS.get(picture);

  if (picture === HELICOPTER_PICTURE) {
    for (const other of [1, 3, 5, 7, 9, 11]) {
      outdoor.scene.objects[other].grabbable = false;
    }
  }

  if (hint === undefined) {
    return;
  }

  outdoor.lock();
  outdoor.say(hint);
}

function layerUnfinished(outdoor: Outdoor, picture: number): boolean {
  const layer = PICTURE_LAYERS.get(picture);

  if (!layer) {
    return false;
  }

  return range(layer[0], layer[1]).some((index) => outdoor.visible(index));
}

function startFinale(outdoor: Outdoor): void {
  const scene = outdoor.scene;

  outdoor.setFlag("finaleStarted");
  scene.objects[HELICOPTER_PICTURE].grabbable = false;
  scene.scrollX = FINAL_SCROLL;
  outdoor.say(ROAD_REVEAL);
}

function pictureReturned(outdoor: Outdoor, picture: number): void {
  const spansInstalled = outdoor.visible(SPAN_A) && outdoor.visible(SPAN_B);
  const canFinish =
    picture === HELICOPTER_PICTURE && spansInstalled && !outdoor.flag("finaleStarted");

  if (canFinish) {
    startFinale(outdoor);
    return;
  }

  if (layerUnfinished(outdoor, picture)) {
    outdoor.say(NOT_FINISHED);
  }
}

function loadPlaced(outdoor: Outdoor): void {
  const spansInstalled = outdoor.visible(SPAN_A) && outdoor.visible(SPAN_B);
  const bridgeLineHeard = outdoor.scene.objects[BRIDGE_DONE].finished;

  if (spansInstalled && !bridgeLineHeard) {
    outdoor.say(BRIDGE_DONE);
  }
}

function itemPicked(outdoor: Outdoor, item: number): void {
  if (!DECORATIONS.includes(item)) {
    return;
  }

  const [targetX, targetY] = targetOf(outdoor.engine, item);

  outdoor.scene.moveTo(ARROW, targetX, targetY);
  outdoor.show(ARROW);
}

function placeDecoration(outdoor: Outdoor, item: number): void {
  const scene = outdoor.scene;
  const [targetX, targetY] = targetOf(outdoor.engine, item);

  scene.moveTo(item, targetX, targetY);
  outdoor.hide(item, ARROW);

  if (item === BILLBOARD) {
    outdoor.show(BILLBOARD_INSTALLED);
    outdoor.rewind(BILLBOARD_CAR);
    outdoor.rewind(BILLBOARD_CAR_LEAVES);
    outdoor.say(BILLBOARD_CAR);
    return;
  }

  outdoor.say(item - 1);
}

function itemDropped(outdoor: Outdoor, item: number): void {
  if (!DECORATIONS.includes(item)) {
    return;
  }

  if (isNearTarget(outdoor.engine, item)) {
    placeDecoration(outdoor, item);
    return;
  }

  const hidesArrowAnyway = item === 190 || item === 192 || item === 194;

  if (hidesArrowAnyway) {
    outdoor.hide(ARROW);
  }
}

function semiArrived(outdoor: Outdoor): void {
  outdoor.sfx(7);

  if (outdoor.semiCarries(BRIDGE_CHAIN)) {
    outdoor.unlock();
    return;
  }

  if (outdoor.semiCarries(BILLBOARD)) {
    outdoor.say(DECORATIONS_ARRIVED);
    return;
  }

  if (outdoor.semiCarries(SIGN_CHAIN)) {
    outdoor.say(SIGNS_ARRIVED);
  }
}

function semiLeft(outdoor: Outdoor): void {
  outdoor.hide(SEMI);

  if (isDone(outdoor) && !outdoor.flag("signsDelivered")) {
    outdoor.setFlag("signsDelivered");
    outdoor.bringSemi(SIGN_CHAIN);
  }
}

function hideAndPlay(outdoor: Outdoor, object: number, clip: number): void {
  outdoor.hide(object);
  outdoor.say(clip);
}

function prospectorAfter(outdoor: Outdoor, abseil: number, chance: number, first: number): void {
  outdoor.hide(abseil);

  if (outdoor.chance(chance)) {
    outdoor.say(outdoor.pick(first, 2));
  }
}

function heliReturned(outdoor: Outdoor): void {
  const scene = outdoor.scene;
  const picture = scene.objects[HELICOPTER_PICTURE];

  scene.moveTo(HELICOPTER_PICTURE, picture.def.x, picture.def.y);
  outdoor.hide(HELICOPTER);
  outdoor.show(HELICOPTER_PICTURE);
  outdoor.engine.release();
  outdoor.say(CAR_DRIVES_THROUGH);
}

function checkRoadFinished(outdoor: Outdoor): void {
  const roadClear = range(TANKER_LAYER_FIRST, ROAD_CHECK_LAST).every(
    (index) => !outdoor.visible(index),
  );

  if (!roadClear) {
    return;
  }

  outdoor.lock();
  outdoor.show(HELICOPTER_PICTURE);
  outdoor.say(ROAD_DONE_LINE);
}

function finishedSteps(outdoor: Outdoor): Map<number, () => void> {
  return new Map<number, () => void>([
    [TUNNEL_FIRST, () => outdoor.say(TUNNEL_OPEN)],
    [161, () => prospectorAfter(outdoor, 162, 50, 218)],
    [162, () => outdoor.say(161)],
    [163, () => outdoor.say(162)],
    [166, () => prospectorAfter(outdoor, 167, 50, 219)],
    [167, () => outdoor.say(166)],
    [168, () => outdoor.say(167)],
    [171, () => prospectorAfter(outdoor, 172, 100, 219)],
    [172, () => outdoor.say(171)],
    [173, () => outdoor.say(TUNNEL_CLIP)],
    [ROAD_REVEAL, () => outdoor.say(outdoor.chance(50) ? 233 : 221)],
    [CAR_DRIVES_THROUGH, () => outdoor.say(COMPLETE_CLIP)],
    [
      INTRO,
      () => {
        outdoor.show(TASK_CARD);
        outdoor.hide(INTRO);
        outdoor.say(TASK_NARRATION);
      },
    ],
    [TUNNEL_CLIP, () => outdoor.say(172)],
    [ROAD_DONE_LINE, () => outdoor.bringSemi(BRIDGE_CHAIN)],
    [221, () => heliReturned(outdoor)],
    [233, () => heliReturned(outdoor)],
    [
      COMPLETE_CLIP,
      () => {
        outdoor.complete(ACTIVITY_DESERT);
        outdoor.say(COMPLETION_LINE);
      },
    ],
    [BILLBOARD_CAR, () => hideAndPlay(outdoor, BILLBOARD_CAR, BILLBOARD_CAR_LEAVES)],
    [
      BILLBOARD_CAR_LEAVES,
      () => {
        outdoor.show(BILLBOARD);
        outdoor.hide(BILLBOARD_INSTALLED);
      },
    ],
    [
      TASK_NARRATION,
      () => {
        outdoor.prime(COWBOY_INTRO);
        outdoor.say(COWBOY_INTRO);
        outdoor.hide(TASK_CARD);
      },
    ],
    [COMPLETION_LINE, () => outdoor.bringSemi(BILLBOARD)],
    [
      DECORATIONS_ARRIVED,
      () => {
        outdoor.setLayer(ROAD_REVEAL, 0);
        outdoor.setLayer(CAR_DRIVES_THROUGH, 0);
      },
    ],
  ]);
}

function finished(outdoor: Outdoor, object: number): void {
  const isTankerTile = object >= TANKER_LAYER_FIRST && object <= TANKER_LAYER_LAST;

  if (UNLOCKING_CLIPS.includes(object)) {
    outdoor.unlock();
    return;
  }

  if (isTankerTile) {
    checkRoadFinished(outdoor);
    return;
  }

  if (DECORATION_CLIPS.includes(object)) {
    outdoor.show(object + 1);
    outdoor.hide(object);
    outdoor.rewind(object);
    return;
  }

  finishedSteps(outdoor).get(object)?.();
}

function speechSkipped(outdoor: Outdoor, object: number): boolean {
  const isIntroPart = [INTRO, COWBOY_INTRO, TASK_NARRATION].includes(object);

  if (!isIntroPart) {
    return false;
  }

  outdoor.hide(object, TASK_CARD);

  return true;
}

function idle(outdoor: Outdoor): void {
  if (isDone(outdoor)) {
    return;
  }

  const nearStart = outdoor.scene.scrollX < 600;
  const choices = nearStart && outdoor.chance(49) ? [196, 197] : [234, 235];
  const clip = outdoor.pickIdle(choices);

  outdoor.say(clip);
}

export const desert = createOutdoorLogic({
  moduleNumber: 3,
  semi: SEMI,
  puffAnimation: PUFF,
  helicopter: HELICOPTER,
  pictures: new Map([
    [LOADER_PICTURE, LOADER],
    [GRADER_PICTURE, GRADER],
    [TANKER_PICTURE, TANKER],
    [PAVER_PICTURE, PAVER],
    [ROLLER_PICTURE, ROLLER],
    [DOZER_PICTURE, DOZER],
    [HELICOPTER_PICTURE, HELICOPTER],
  ]),
  enter,
  finished,
  speechSkipped,
  bump,
  worked,
  axisLock,
  picturePicked,
  pictureReturned,
  loadPlaced,
  itemPicked,
  itemDropped,
  semiArrived,
  semiLeft,
  idle,
});
