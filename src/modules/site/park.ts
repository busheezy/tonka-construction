import { ACTIVITY_PARK } from "../../engine/progress";
import { createSiteLogic, type Site } from "./site";

const EXCAVATOR = 0;
const CRANE = 1;
const LAWN = 4;
const HEAPS = [6, 7, 8];
const POND = 9;
const FIRST_SURVEYOR = 10;
const LAST_SURVEYOR = 13;
const CREW_LEAVES = 14;
const PLAYGROUND_ITEMS = [16, 18, 20, 22, 24, 26];
const PLAYGROUND_CHAIN = 16;
const BRIDGE = 31;
const OUTLINE = 33;
const LAST_STAKE = 37;
const STAKE_OFFSET = 24;
const EXCAVATOR_JOB = 38;
const CRANE_JOB = 39;
const PLAYGROUND_SPEECH = 40;
const CRANE_QUIPS = [43, 44, 45];
const BOARD_VOICE = 46;
const INTRO = 47;
const INTRO_PART_TWO = 48;
const TASK_BOARD = 49;
const BONUS_CHAIN = 50;
const BONUS_ITEMS = [50, 51, 52, 53, 54, 55, 56];
const BONUS_SHOWN = [55, 56];
const EXCAVATOR_NOT_NEEDED = 57;
const CRANE_NOT_NEEDED = 58;
const COMPLETION_LINE = 60;
const REVISIT_INCOMPLETE = 61;
const REVISIT_COMPLETE = 62;
const IDLE_HINTS = [64, 65];
const MARK_POND = 67;
const DUMP_ANIMATION = 69;
const CRANE_CALL_HEIGHT = 300;
const HELP_FIRST = 50;
const HELP_LAST = 60;

function isDone(site: Site): boolean {
  return site.engine.progress.done[ACTIVITY_PARK];
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

  site.hide(object, INTRO, TASK_BOARD);
  site.say(FIRST_SURVEYOR);

  return true;
}

function finishSurvey(site: Site, object: number): void {
  site.show(object + STAKE_OFFSET);

  if (object === LAST_SURVEYOR) {
    site.show(LAST_STAKE);
    site.say(MARK_POND);
    return;
  }

  site.say(object + 1);
}

function finishIntroParts(site: Site, object: number): boolean {
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
      MARK_POND,
      () => {
        site.show(OUTLINE);
        site.hide(MARK_POND);
        site.say(CREW_LEAVES);
      },
    ],
    [
      CREW_LEAVES,
      () => {
        site.callVehicle();
        site.flashArrows();
      },
    ],
    [PLAYGROUND_SPEECH, () => completePark(site)],
  ]);
  const step = steps.get(object);

  step?.();

  return step !== undefined;
}

function completePark(site: Site): void {
  site.complete(ACTIVITY_PARK);
  site.say(COMPLETION_LINE);
}

function finished(site: Site, object: number): void {
  const handled = finishIntroParts(site, object);
  const isSurveyor = object >= FIRST_SURVEYOR && object <= LAST_SURVEYOR;

  if (handled || !isSurveyor) {
    return;
  }

  finishSurvey(site, object);
}

function vehicleArrived(site: Site, vehicle: number): void {
  site.engine.audio.playWav("sfx7.wav").catch(() => undefined);

  if (vehicle === EXCAVATOR) {
    const heapsGone = site.allHidden(HEAPS);

    site.say(heapsGone ? EXCAVATOR_NOT_NEEDED : EXCAVATOR_JOB);
    return;
  }

  const pondPlayed = site.scene.objects[POND].finished;
  const bridgeCalled = site.flag("bridgeCalled");
  const craneNotNeeded = !pondPlayed || bridgeCalled;

  site.say(craneNotNeeded ? CRANE_NOT_NEEDED : CRANE_JOB);
}

function fillPond(site: Site): void {
  const heapsGone = site.allHidden(HEAPS);

  if (!heapsGone || site.visible(POND)) {
    return;
  }

  for (let stake = OUTLINE; stake <= LAST_STAKE; stake += 1) {
    site.hide(stake);
  }

  site.engine.play(POND, 2, false);
}

function vehicleLeft(site: Site, vehicle: number): void {
  site.hide(vehicle);

  if (vehicle === EXCAVATOR) {
    fillPond(site);
    return;
  }

  const bringsPlayground = vehicle === CRANE && !isDone(site) && site.flag("bridgePlaced");

  if (bringsPlayground) {
    site.show(LAWN);
    site.bringFlatbed(PLAYGROUND_CHAIN);
  }
}

function vehicleMoved(site: Site, vehicle: number): void {
  const object = site.scene.objects[vehicle];
  const callsBridge =
    vehicle === CRANE &&
    object.y < CRANE_CALL_HEIGHT &&
    site.visible(POND) &&
    !site.flag("bridgeCalled");

  if (!callsBridge) {
    return;
  }

  site.setFlag("bridgeCalled");
  site.bringFlatbed(BRIDGE);
}

function semiArrived(site: Site): void {
  site.engine.audio.playWav("sfx7.wav").catch(() => undefined);

  if (site.flatbedCarries(PLAYGROUND_CHAIN) && !isDone(site)) {
    site.say(PLAYGROUND_SPEECH);
  }
}

function semiLeft(site: Site): void {
  if (!isDone(site) || site.flag("bonusDelivered")) {
    return;
  }

  site.setFlag("bonusDelivered");
  site.show(...BONUS_SHOWN);
  site.bringFlatbed(BONUS_CHAIN);
}

function dropped(site: Site, item: number): boolean {
  if (item === BRIDGE) {
    site.setFlag("bridgePlaced");
    return true;
  }

  return !PLAYGROUND_ITEMS.includes(item);
}

function scooped(site: Site): void {
  site.engine.audio.playWav("sfx5.wav").catch(() => undefined);

  if (site.allHidden(HEAPS)) {
    site.flashArrows();
  }
}

function idle(site: Site): void {
  if (isDone(site)) {
    return;
  }

  site.say(site.pickIdle(IDLE_HINTS));
}

export const park = createSiteLogic({
  moduleNumber: 4,
  flatbed: 2,
  crane: CRANE,
  dumpAnimation: DUMP_ANIMATION,
  craneQuips: CRANE_QUIPS,
  acceptsAnyDrop: true,
  chains: [PLAYGROUND_ITEMS, BONUS_ITEMS],
  enter,
  finished,
  speechSkipped: skipIntro,
  vehicleArrived,
  vehicleLeft,
  semiArrived,
  semiLeft,
  vehicleMoved,
  dropped,
  scooped,
  idle,
});
