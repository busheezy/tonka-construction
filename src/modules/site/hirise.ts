import { ACTIVITY_HIRISE } from "../../engine/progress";
import { createSiteLogic, type Site } from "./site";

const EXCAVATOR = 0;
const CRANE = 1;
const PILE_DRIVER = 2;
const MIXER = 3;
const GROUND_OVERLAY = 6;
const FIRST_SURVEYOR = 7;
const LAST_SURVEYOR = 10;
const CREW_LEAVES = 11;
const STAKE_OFFSET = 77;
const STAKES = [84, 85, 86, 87];
const HEAPS = [13, 14, 15, 16, 17, 18];
const PILE_ANIMATIONS = [19, 21, 23, 25];
const COLUMN_STATICS = [43, 46, 49, 52];
const COLUMN_SETTLES = [45, 48, 51, 54];
const BEAM_STATICS = [55, 57, 59, 61];
const BEAM_ITEMS = [56, 58, 60, 62];
const SLAB_MARKER = 110;
const FLOOR_BOX = { left: 217, right: 379, top: 236, bottom: 380 };
const WALL_BOX = { left: 207, right: 379, top: 236, bottom: 380 };
const POUR_LEFT = 160;
const POUR_TOP = 245;
const POUR_HEADING = 7;
const MARKER_LEFT = 212;
const MARKER_TOP = 275;
const COLUMN_GUIDE = 97;
const BEAM_GUIDE = 98;
const COLUMN_GUIDE_LEAVES = 138;
const BEAM_GUIDE_LEAVES = 139;
const FACADE_CHOOSER = 95;
const TOWER = 96;
const FACADE_COUNT = 3;
const AMBIENT = 100;
const DECOR_MARKER = 179;
const PILE_QUIPS = [124, 125];
const PILE_CHAIN = 20;
const COLUMN_CHAIN = 44;
const BEAM_CHAIN = 56;
const FIRST_SLAB = 64;
const SECOND_SLAB = 68;
const THIRD_SLAB = 72;
const CLADDING = 78;
const DECOR_CHAIN = 103;
const BONUS_CHAIN = 173;
const CRANE_LOCK_Y = 281;
const CRANE_CALL_HEIGHT = 300;
const SLAB_CRANE_X = 175;
const SLAB_CRANE_Y = 285;
const SLAB_CRANE_HEADING = 8;
const IDLE_HINTS = [141, 142, 143];
const HELP_FIRST = 50;
const HELP_LAST = 60;
const QUIP_CHANCE_PERCENT = 24;

interface PileSpot {
  item: number;
  animation: number;
  marker: number;
  guide: [number, number];
  box: { left: number; right: number; top: number; bottom: number };
  driverTopLeft: [number, number];
  heading: number;
}

const PILES: PileSpot[] = [
  {
    item: 20,
    animation: 19,
    marker: 108,
    guide: [292, 133],
    box: { left: 335, right: 443, top: 8, bottom: 116 },
    driverTopLeft: [280, -59],
    heading: 7,
  },
  {
    item: 22,
    animation: 21,
    marker: 109,
    guide: [435, 183],
    box: { left: 469, right: 577, top: 68, bottom: 176 },
    driverTopLeft: [425, -9],
    heading: 7,
  },
  {
    item: 24,
    animation: 23,
    marker: 110,
    guide: [232, 198],
    box: { left: 124, right: 232, top: 100, bottom: 208 },
    driverTopLeft: [94, 17],
    heading: 4,
  },
  {
    item: 26,
    animation: 25,
    marker: 111,
    guide: [374, 252],
    box: { left: 432, right: 540, top: 228, bottom: 336 },
    driverTopLeft: [373, 138],
    heading: 10,
  },
];

const COLUMN_GUIDE_SPOTS = new Map<number, [number, number]>([
  [44, [292, 133]],
  [47, [435, 183]],
  [50, [232, 198]],
  [53, [374, 252]],
]);

const BEAM_GUIDE_SPOTS = new Map<number, [number, number]>([
  [56, [381, 145]],
  [58, [291, 116]],
  [60, [434, 238]],
  [62, [330, 222]],
]);

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

function isDone(site: Site): boolean {
  return site.engine.progress.done[ACTIVITY_HIRISE];
}

function isInside(box: Box, x: number, y: number): boolean {
  const insideX = x >= box.left && x <= box.right;
  const insideY = y >= box.top && y <= box.bottom;

  return insideX && insideY;
}

function moveTopLeft(site: Site, index: number, left: number, top: number): void {
  const object = site.scene.objects[index];
  const width = object.image?.width ?? 0;
  const height = object.image?.height ?? 0;

  site.scene.moveTo(index, left + (width >> 1), top + (height >> 1));
}

function isPileDriven(site: Site, animation: number): boolean {
  return site.flag(`driven${animation}`);
}

function allPilesDriven(site: Site): boolean {
  return PILE_ANIMATIONS.every((animation) => isPileDriven(site, animation));
}

function enter(site: Site): number | undefined {
  const intro = site.scene.objects[135];
  const previous = site.engine.previousModule;
  const cameFromHelp = previous >= HELP_FIRST && previous <= HELP_LAST;

  if (!intro.finished || cameFromHelp) {
    return undefined;
  }

  const revisit = isDone(site) ? 157 : 156;

  site.scene.objects[revisit].finished = false;

  return revisit;
}

function skipIntro(site: Site, object: number): boolean {
  const isIntroPart = [134, 135, 136].includes(object);

  if (!isIntroPart) {
    return false;
  }

  site.hide(object, 137, 135);
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

function introStep(site: Site, object: number): boolean {
  const steps = new Map<number, () => void>([
    [
      135,
      () => {
        site.show(137);
        site.say(134);
      },
    ],
    [
      134,
      () => {
        site.prime(136);
        site.hide(137, 135);
        site.say(136);
      },
    ],
    [136, () => site.say(FIRST_SURVEYOR)],
    [
      CREW_LEAVES,
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
  const isSurveyor = object >= FIRST_SURVEYOR && object <= LAST_SURVEYOR;

  if (!isSurveyor) {
    return false;
  }

  site.show(object + STAKE_OFFSET);
  site.hide(object);
  site.say(object + 1);

  return true;
}

function pileDriven(site: Site, animation: number): boolean {
  const pile = PILES.find((spot) => spot.animation === animation);

  if (!pile) {
    return false;
  }

  site.hide(pile.marker);
  site.setLayer(animation, 0);
  site.engine.inputLocked = false;
  site.setFlag(`driven${animation}`);

  if (!allPilesDriven(site)) {
    return true;
  }

  site.flashArrows();
  site.setFlag("pilesDriven");

  if (site.engine.random(100) < QUIP_CHANCE_PERCENT) {
    site.randomQuip(PILE_QUIPS);
  }

  return true;
}

function chainStep(site: Site, object: number, steps: Map<number, () => void>): boolean {
  const step = steps.get(object);

  step?.();

  return step !== undefined;
}

function floorPourSteps(site: Site): Map<number, () => void> {
  return new Map<number, () => void>([
    [28, () => site.say(29)],
    [29, () => site.say(30)],
    [
      30,
      () => {
        site.show(34);
        site.say(31);
      },
    ],
    [
      31,
      () => {
        site.show(35);
        site.say(32);
      },
    ],
    [
      32,
      () => {
        site.show(36);
        site.say(33);
      },
    ],
    [
      33,
      () => {
        site.show(37);
        site.hide(33);
        site.engine.inputLocked = false;
      },
    ],
  ]);
}

function wallPourSteps(site: Site): Map<number, () => void> {
  return new Map<number, () => void>([
    [41, () => site.say(40)],
    [40, () => site.say(38)],
    [38, () => site.say(39)],
    [
      39,
      () => {
        site.hide(SLAB_MARKER, 34);
        site.say(42);
      },
    ],
    [
      42,
      () => {
        site.show(115);
        site.hide(42, 35);
        site.say(83);
      },
    ],
    [
      83,
      () => {
        site.show(116);
        site.hide(83);
        site.say(112);
      },
    ],
    [
      112,
      () => {
        site.show(117);
        site.hide(112, 37);
        site.say(113);
      },
    ],
    [
      113,
      () => {
        site.hide(113, 36);
        site.say(114);
      },
    ],
    [
      114,
      () => {
        site.engine.inputLocked = false;
        site.flashArrows();
      },
    ],
  ]);
}

function slabSteps(site: Site): Map<number, () => void> {
  return new Map<number, () => void>([
    [
      66,
      () => {
        site.show(169);
        site.hide(66);
        site.say(163);
      },
    ],
    [
      163,
      () => {
        site.show(170);
        site.hide(163);
        site.say(164);
      },
    ],
    [
      164,
      () => {
        site.setLayer(164, 1);

        for (const index of [49, 52, 59, 61]) {
          site.setLayer(index, 0);
        }

        site.bringFlatbed(SECOND_SLAB);
      },
    ],
    [69, () => site.say(165)],
    [
      165,
      () => {
        site.show(171);
        site.hide(165);
        site.say(166);
      },
    ],
    [
      166,
      () => {
        site.show(172);
        site.hide(166);
        site.say(167);
      },
    ],
    [
      167,
      () => {
        site.hide(67);
        site.bringFlatbed(THIRD_SLAB);
      },
    ],
    [74, () => site.say(168)],
    [168, () => site.say(75)],
    [75, () => site.say(76)],
    [76, () => finishFrame(site)],
  ]);
}

function finishFrame(site: Site): void {
  site.show(162);

  const hidden = [
    ...range(19, 74),
    77,
    180,
    181,
    ...range(163, 172),
    ...range(112, 117),
    BEAM_GUIDE_LEAVES,
  ];

  site.hide(...hidden);

  if (!site.flag("claddingCalled")) {
    site.setFlag("claddingCalled");
    site.bringFlatbed(CLADDING);
  }

  for (const index of [75, 76, 162]) {
    site.setLayer(index, 0);
  }
}

function claddingSteps(site: Site): Map<number, () => void> {
  return new Map<number, () => void>([
    [79, () => site.say(80)],
    [
      80,
      () => {
        site.hide(162, 75);
        site.say(81);
      },
    ],
    [
      81,
      () => {
        site.hide(76);
        site.say(82);
      },
    ],
    [
      82,
      () => {
        site.hide(76);

        for (const index of range(79, 82)) {
          site.setLayer(index, 0);
        }

        site.flashArrows();
      },
    ],
  ]);
}

function crewSteps(site: Site): Map<number, () => void> {
  const steps = new Map<number, () => void>();

  for (let crew = 88; crew < 94; crew += 1) {
    const next = crew + 1;
    const hidesEarlier = next >= 90 && next <= 93;

    steps.set(crew, () => {
      if (hidesEarlier) {
        site.hide(next - 2);
      }

      site.say(next);
    });
  }

  steps.set(94, () => {
    site.show(GROUND_OVERLAY);
    site.say(FACADE_CHOOSER);
  });
  steps.set(FACADE_CHOOSER, () => {
    site.show(TOWER);
    site.hide(...range(79, 83));
    site.bringFlatbed(DECOR_CHAIN);
  });

  return steps;
}

function completionSteps(site: Site): Map<number, () => void> {
  return new Map<number, () => void>([
    [
      133,
      () => {
        site.complete(ACTIVITY_HIRISE);
        site.say(132);
        site.flashArrows();
      },
    ],
    [132, () => site.say(153)],
    [
      104,
      () => {
        site.show(105);
        site.hide(106);
        site.engine.stopStream(104, "rewind");
      },
    ],
  ]);
}

function settleFinished(site: Site, object: number): boolean {
  if (!COLUMN_SETTLES.includes(object)) {
    return false;
  }

  if (site.visible(COLUMN_GUIDE)) {
    guideLeaves(site, COLUMN_GUIDE, COLUMN_GUIDE_LEAVES, -3, -27);
    return true;
  }

  const columnsUp = site.allVisible(COLUMN_STATICS);

  if (columnsUp && !site.flag("beamsCalled")) {
    site.setFlag("beamsCalled");
    site.bringFlatbed(BEAM_CHAIN, true);
  }

  return true;
}

function finished(site: Site, object: number): void {
  const tables = [
    floorPourSteps(site),
    wallPourSteps(site),
    slabSteps(site),
    claddingSteps(site),
    crewSteps(site),
    completionSteps(site),
  ];
  const handledByTable = tables.some((steps) => chainStep(site, object, steps));

  if (handledByTable) {
    return;
  }

  const handlers = [introStep, surveyStep, pileDriven, settleFinished];

  handlers.some((handler) => handler(site, object));
}

function vehicleArrived(site: Site, vehicle: number): void {
  site.engine.audio.playWav("sfx7.wav").catch(() => undefined);

  const lines = new Map<number, () => number>([
    [EXCAVATOR, () => (site.allHidden(HEAPS) ? 146 : 129)],
    [CRANE, () => 144],
    [PILE_DRIVER, () => (pileDriverNeeded(site) ? 128 : 147)],
    [MIXER, () => (site.flag("pilesDriven") && !site.flag("wallsPoured") ? 130 : 145)],
  ]);
  const line = lines.get(vehicle)?.();

  if (line !== undefined) {
    site.say(line);
  }
}

function pileDriverNeeded(site: Site): boolean {
  const pilesStanding = site.allVisible(PILE_ANIMATIONS);

  return site.flag("heapsDug") && pilesStanding && !allPilesDriven(site);
}

function vehicleLeft(site: Site, vehicle: number): void {
  site.hide(vehicle);

  if (vehicle === PILE_DRIVER) {
    site.hide(108, 109, 110, 111);
    return;
  }

  if (vehicle === MIXER) {
    site.hide(SLAB_MARKER);
    return;
  }

  const startsCrew = vehicle === CRANE && site.visible(81) && !site.flag("crewStarted");

  if (startsCrew) {
    site.setFlag("crewStarted");
    site.say(88);
  }
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

  if (vehicle !== CRANE) {
    return;
  }

  if (site.flag("craneLocked") && object.y < CRANE_LOCK_Y) {
    site.scene.moveTo(CRANE, object.x, CRANE_LOCK_Y);
  }

  if (object.y >= CRANE_CALL_HEIGHT) {
    return;
  }

  if (site.flag("heapsDug")) {
    callDelivery(site, "pilesCalled", PILE_CHAIN);
  }

  if (site.visible(117)) {
    callDelivery(site, "columnsCalled", COLUMN_CHAIN);
  }
}

function showMarkerTopLeft(site: Site): void {
  moveTopLeft(site, SLAB_MARKER, MARKER_LEFT, MARKER_TOP);
  site.show(SLAB_MARKER);
}

function showDecorMarker(site: Site, item: number): void {
  const def = site.scene.objects[item].def;
  const targetX = def.raw.getInt16(0x7c, true);
  const targetY = def.raw.getInt16(0x7e, true);
  const markerHeight = site.scene.objects[DECOR_MARKER].image?.height ?? 0;

  site.scene.moveTo(DECOR_MARKER, targetX, targetY - (markerHeight >> 1));
  site.show(DECOR_MARKER);
}

function pickPileDriver(site: Site): void {
  for (const pile of PILES) {
    const isStanding = site.visible(pile.animation) && !isPileDriven(site, pile.animation);

    if (isStanding) {
      site.show(pile.marker);
    }
  }
}

function pickSlab(site: Site, item: number): void {
  showMarkerTopLeft(site);

  if (item !== FIRST_SLAB) {
    return;
  }

  site.scene.moveTo(CRANE, SLAB_CRANE_X, SLAB_CRANE_Y);
  site.scene.setPose(CRANE, SLAB_CRANE_HEADING, 0, site.scene.objects[CRANE].toolFrame);
  site.setFlag("craneLocked");
}

function itemPicked(site: Site, item: number): void {
  const pile = PILES.find((spot) => spot.item === item);
  const columnSpot = COLUMN_GUIDE_SPOTS.get(item);
  const beamSpot = BEAM_GUIDE_SPOTS.get(item);

  if (pile) {
    site.playAt(COLUMN_GUIDE, pile.guide[0], pile.guide[1]);
    return;
  }

  if (columnSpot) {
    site.playAt(COLUMN_GUIDE, columnSpot[0], columnSpot[1]);
    return;
  }

  if (beamSpot) {
    site.playAt(BEAM_GUIDE, beamSpot[0], beamSpot[1]);
    return;
  }

  pickOther(site, item);
}

function pickOther(site: Site, item: number): void {
  const pickHandlers = new Map<number, () => void>([
    [PILE_DRIVER, () => pickPileDriver(site)],
    [FIRST_SLAB, () => pickSlab(site, item)],
    [SECOND_SLAB, () => pickSlab(site, item)],
    [THIRD_SLAB, () => pickSlab(site, item)],
    [103, () => showDecorMarker(site, item)],
    [105, () => showDecorMarker(site, item)],
  ]);
  const needsMixerMarker = item === MIXER && site.flag("pilesDriven") && !site.flag("wallsPoured");

  if (needsMixerMarker) {
    showMarkerTopLeft(site);
    return;
  }

  pickHandlers.get(item)?.();
}

function dropPile(site: Site, item: number): void {
  site.activatePartner(item);

  if (site.visible(COLUMN_GUIDE)) {
    guideLeaves(site, COLUMN_GUIDE, COLUMN_GUIDE_LEAVES, -3, -27);
    return;
  }

  site.flashArrows();
}

function dropColumn(site: Site, item: number): void {
  site.activatePartner(item);
  site.engine.play(item + 1, 2, false);
}

function dropBeam(site: Site, item: number): void {
  site.activatePartner(item);

  if (site.visible(BEAM_GUIDE)) {
    guideLeaves(site, BEAM_GUIDE, BEAM_GUIDE_LEAVES, 1, 1);
  }

  if (site.allVisible(BEAM_STATICS)) {
    callDelivery(site, "slabsCalled", FIRST_SLAB);
  }
}

function dropFirstSlab(site: Site): void {
  site.hide(SLAB_MARKER, 63, FIRST_SLAB);

  for (const index of range(43, 61)) {
    site.setLayer(index, 0);
  }

  site.show(180, 181);
  site.say(66);
}

function dropSlab(site: Site, item: number, standIn: number, animation: number): void {
  site.hide(SLAB_MARKER, standIn, item);
  site.say(animation);
}

function dropCladding(site: Site): void {
  site.hide(SLAB_MARKER, ...range(43, 63), 77, 180, 181, 69, CLADDING);

  for (const index of [164, 169, 170]) {
    site.setLayer(index, 0);
  }

  for (const index of [167, 171, 172]) {
    site.setLayer(index, 1);
  }

  site.setLayer(74, 2);
  site.setLayer(168, 2);
  site.say(79);
}

function dropped(site: Site, item: number): boolean {
  const handlers = new Map<number, () => void>([
    [FIRST_SLAB, () => dropFirstSlab(site)],
    [SECOND_SLAB, () => dropSlab(site, item, 67, 69)],
    [THIRD_SLAB, () => dropSlab(site, item, 71, 74)],
    [CLADDING, () => dropCladding(site)],
  ]);

  for (const pile of PILES) {
    handlers.set(pile.item, () => dropPile(site, item));
  }

  for (const column of COLUMN_GUIDE_SPOTS.keys()) {
    handlers.set(column, () => dropColumn(site, item));
  }

  for (const beam of BEAM_ITEMS) {
    handlers.set(beam, () => dropBeam(site, item));
  }

  const handler = handlers.get(item);

  if (!handler) {
    site.hide(DECOR_MARKER);
    return false;
  }

  handler();

  return true;
}

function drivePile(site: Site, pile: PileSpot): void {
  moveTopLeft(site, PILE_DRIVER, pile.driverTopLeft[0], pile.driverTopLeft[1]);
  site.scene.setPose(PILE_DRIVER, pile.heading, 0, 0);
  site.engine.inputLocked = true;

  if (pile.animation === 25) {
    site.setLayer(25, 2);
  }

  site.engine.play(pile.animation, 2, false);
}

function workPileDriver(site: Site): boolean {
  const driver = site.scene.objects[PILE_DRIVER];
  const pile = PILES.find((spot) => {
    const isStanding = site.visible(spot.animation) && !isPileDriven(site, spot.animation);

    return isStanding && isInside(spot.box, driver.x, driver.y);
  });

  if (!pile) {
    return false;
  }

  drivePile(site, pile);

  return true;
}

function pour(site: Site, flag: string, firstAnimation: number): void {
  const scene = site.scene;

  moveTopLeft(site, MIXER, POUR_LEFT, POUR_TOP);
  scene.setPose(MIXER, POUR_HEADING, 0, 0);
  site.setFlag(flag);
  site.engine.inputLocked = true;
  site.say(firstAnimation);
}

function workMixer(site: Site): boolean {
  const mixer = site.scene.objects[MIXER];
  const canPourFloor = site.flag("pilesDriven") && !site.flag("floorPoured");
  const canPourWalls = site.flag("floorPoured") && !site.flag("wallsPoured");

  if (canPourFloor && isInside(FLOOR_BOX, mixer.x, mixer.y)) {
    pour(site, "floorPoured", 28);
    return true;
  }

  if (canPourWalls && isInside(WALL_BOX, mixer.x, mixer.y)) {
    pour(site, "wallsPoured", 41);
    return true;
  }

  return false;
}

function workClick(site: Site, vehicle: number): boolean {
  if (vehicle === PILE_DRIVER) {
    return workPileDriver(site);
  }

  if (vehicle === MIXER) {
    return workMixer(site);
  }

  return false;
}

function semiArrived(site: Site): void {
  site.engine.audio.playWav("sfx7.wav").catch(() => undefined);

  const lines = new Map<number, number>([
    [PILE_CHAIN, 127],
    [BEAM_CHAIN, 131],
  ]);
  const flatbed = site.scene.objects[4];
  const line = lines.get(flatbed.link);

  if (line !== undefined) {
    site.say(line);
    return;
  }

  if (flatbed.link === DECOR_CHAIN && !isDone(site)) {
    site.say(133);
  }
}

function semiLeft(site: Site): void {
  if (isDone(site) && !site.flag("bonusDelivered")) {
    site.setFlag("bonusDelivered");
    site.bringFlatbed(BONUS_CHAIN);
  }
}

function scooped(site: Site): void {
  site.engine.audio.playWav("sfx5.wav").catch(() => undefined);

  const heapsGone = site.allHidden(HEAPS);

  if (!heapsGone || !site.visible(STAKES[0])) {
    return;
  }

  site.setFlag("heapsDug");
  site.flashArrows();
  site.hide(...STAKES);
}

function click(site: Site, object: number): void {
  if (object !== FACADE_CHOOSER) {
    return;
  }

  const tower = site.scene.objects[TOWER];
  const nextFacade = (tower.frame + 1) % FACADE_COUNT;

  site.scene.setFrame(TOWER, nextFacade);
  site.show(TOWER);
}

function idle(site: Site): void {
  const state = site.state;

  if (isDone(site)) {
    if (!state.semiPresent) {
      site.engine.play(AMBIENT, 2, false);
    }

    return;
  }

  const busy = state.vehicleOnSite || state.semiPresent;
  const choices = busy ? IDLE_HINTS.filter((hint) => hint !== 141) : IDLE_HINTS;

  site.say(site.pickIdle(choices));
}

const DELIVERY_CHAINS = [
  [20, 22, 24, 26],
  [44, 47, 50, 53],
  [56, 58, 60, 62],
  [103, 105],
  [173, 174, 175, 176, 177, 178],
];

export const hirise = createSiteLogic({
  moduleNumber: 6,
  chains: DELIVERY_CHAINS,
  flatbed: 4,
  crane: CRANE,
  dumpAnimation: 182,
  craneQuips: [],
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
});
