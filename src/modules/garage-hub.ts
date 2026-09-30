import type { Engine, ModuleLogic } from "../engine/engine";
import { ACTIVITY_GARAGE } from "../engine/progress";

const MONSTER = 0;
const DOZER = 1;
const GRADER = 2;
const INTRO = 3;
const ALL_BUILT_LINE = 4;
const INTRO_FOLLOW_UP = 5;
const MECHANIC_WALK = 7;
const OIL_DRIP = 8;
const FIRST_IDLE_LINE = 8;
const IDLE_CHOICES = 4;
const GRADER_REENTRY = 12;
const DOZER_REENTRY = 13;
const MONSTER_REENTRY = 14;
const AFTER_ALL_BUILT = 15;
const RESTART_PROMPT = 16;
const RESTART_BUTTON = 17;
const CERTIFICATE_BUTTON = 18;
const MECHANIC_LINE = 19;
const DIALOG_PANEL = 20;
const DIALOG_OK = 21;
const DIALOG_NO = 22;
const RESTART_OVERLAY = "restart";

interface HubState {
  lastIdlePick: number;
  modal: boolean;
}

function hubState(engine: Engine): HubState {
  return engine.state<HubState>(() => ({ lastIdlePick: -1, modal: false }));
}

function reentryLine(engine: Engine): number {
  const scene = engine.requireScene();

  if (scene.objects[MONSTER].visible) {
    return MONSTER_REENTRY;
  }

  if (scene.objects[DOZER].visible) {
    return DOZER_REENTRY;
  }

  return GRADER_REENTRY;
}

function enter(engine: Engine): number | undefined {
  const scene = engine.requireScene();
  const progress = engine.progress;

  hubState(engine).modal = false;
  scene.setVisible(MONSTER, !progress.monsterBuilt);
  scene.setVisible(DOZER, !progress.dozerBuilt);
  scene.setVisible(GRADER, !progress.graderBuilt);

  if (progress.dozerBuilt) {
    scene.objects[OIL_DRIP].visible = false;
    scene.objects[OIL_DRIP].looping = false;
  }

  const allBuilt = progress.monsterBuilt && progress.dozerBuilt && progress.graderBuilt;

  if (allBuilt) {
    return enterAllBuilt(engine);
  }

  if (!scene.objects[INTRO].finished) {
    return undefined;
  }

  const line = reentryLine(engine);

  engine.stopStream(line, "rewind");
  scene.objects[line].finished = false;

  return line;
}

function enterAllBuilt(engine: Engine): number | undefined {
  if (engine.progress.done[ACTIVITY_GARAGE]) {
    return 0;
  }

  engine.progress.complete(ACTIVITY_GARAGE);

  return ALL_BUILT_LINE;
}

function finished(engine: Engine, object: number): void {
  if (object === INTRO) {
    engine.play(INTRO_FOLLOW_UP, 2, true);
    return;
  }

  if (object === ALL_BUILT_LINE) {
    engine.show(RESTART_BUTTON);
    engine.show(CERTIFICATE_BUTTON);
    engine.play(AFTER_ALL_BUILT, 2, true);
    return;
  }

  if (object === MECHANIC_WALK) {
    engine.hide(MECHANIC_WALK);
    engine.play(MECHANIC_LINE, 2, true);
    return;
  }

  if (object === RESTART_PROMPT) {
    engine.stopStream(RESTART_PROMPT, "rewind");
  }
}

function pickIdle(engine: Engine): number {
  if (hubState(engine).lastIdlePick === OIL_DRIP) {
    engine.stopStream(OIL_DRIP, "rewind");
    engine.hide(OIL_DRIP);

    return MECHANIC_WALK;
  }

  const pick = FIRST_IDLE_LINE + engine.random(IDLE_CHOICES);
  const isRepeat = pick === hubState(engine).lastIdlePick;
  const isMissingDrip = pick === OIL_DRIP && engine.progress.dozerBuilt;

  if (isRepeat || isMissingDrip) {
    return pickIdle(engine);
  }

  return pick;
}

function idle(engine: Engine): void {
  if (engine.progress.done[ACTIVITY_GARAGE]) {
    return;
  }

  const pick = pickIdle(engine);

  hubState(engine).lastIdlePick = pick;
  engine.play(pick, 2, pick !== OIL_DRIP);
}

function openRestartDialog(engine: Engine): void {
  hubState(engine).modal = true;
  engine.show(DIALOG_PANEL);
  engine.show(DIALOG_OK);
  engine.show(DIALOG_NO);
  engine.hide(RESTART_BUTTON);
  engine.hide(CERTIFICATE_BUTTON);
  engine.framebuffer.overlays.set(RESTART_OVERLAY, {
    text: "Restart Now?",
    x: 256,
    y: 160,
    font: "bold 24px Arial, Helvetica, sans-serif",
    color: "#0000c0",
  });
  engine.play(RESTART_PROMPT, 2, true);
}

function closeRestartDialog(engine: Engine): void {
  hubState(engine).modal = false;
  engine.hide(DIALOG_PANEL);
  engine.hide(DIALOG_OK);
  engine.hide(DIALOG_NO);
  engine.framebuffer.overlays.delete(RESTART_OVERLAY);
}

function confirmRestart(engine: Engine): void {
  closeRestartDialog(engine);
  engine.resetGarage();
}

function declineRestart(engine: Engine): void {
  closeRestartDialog(engine);
  engine.show(RESTART_BUTTON);
  engine.show(CERTIFICATE_BUTTON);
}

function click(engine: Engine, object: number): void {
  if (hubState(engine).modal) {
    clickDialog(engine, object);
    return;
  }

  if (object === RESTART_BUTTON) {
    openRestartDialog(engine);
  }
}

function clickDialog(engine: Engine, object: number): void {
  if (object === DIALOG_OK) {
    confirmRestart(engine);
    return;
  }

  if (object === DIALOG_NO) {
    declineRestart(engine);
  }
}

export const garageHub: ModuleLogic = {
  enter,
  click,
  finished,
  speechEnded: finished,
  idle,
  backTarget: () => 10,
  blocksLinks: (engine) => hubState(engine).modal,
};
