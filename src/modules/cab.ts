import type { Engine, ModuleLogic } from "../engine/engine";

const LEVER_MS = 55;
const GADGET_MS = 125;
const OUTSIDE_VIEW = 0;
const ENGINE_LOOP = "sfx2.wav";

type BuiltFlag = "monsterBuilt" | "dozerBuilt" | "graderBuilt";

interface Control {
  interval: number;
  sound?: string;
  restart?: boolean;
}

interface CabConfig {
  lastControl: number;
  driveAnimation: number;
  builtFlag: BuiltFlag;
  drivePedal: number;
  keyOn: number;
  keyOff: number;
  controls: Map<number, Control>;
  transitions: Map<number, number>;
  leaveReset: number[];
}

function pairs(entries: [number, number][]): Map<number, number> {
  const map = new Map<number, number>();

  for (const [first, second] of entries) {
    map.set(first, second);
    map.set(second, first);
  }

  return map;
}

function controls(indices: number[], control: Control): [number, Control][] {
  return indices.map((index) => [index, control]);
}

const lever = { interval: LEVER_MS };
const gadget = { interval: GADGET_MS };
const oneShot = { interval: GADGET_MS, restart: true };

const MONSTER_CAB: CabConfig = {
  lastControl: 27,
  driveAnimation: 9,
  builtFlag: "monsterBuilt",
  drivePedal: 1,
  keyOn: 3,
  keyOff: 4,
  controls: new Map([
    ...controls([1, 2, 5, 6, 7, 8, 26, 27], lever),
    ...controls([3, 4], gadget),
    ...controls([10, 18, 19, 20, 22, 24], oneShot),
  ]),
  transitions: pairs([
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8],
    [26, 27],
  ]),
  leaveReset: [1, 2, 3, 4],
};

const DOZER_CAB: CabConfig = {
  lastControl: 17,
  driveAnimation: 13,
  builtFlag: "dozerBuilt",
  drivePedal: 5,
  keyOn: 11,
  keyOff: 12,
  controls: new Map([
    ...controls([3, 4, 5, 6, 7, 8, 9, 10], lever),
    ...controls([11, 12], gadget),
    ...controls([17], oneShot),
  ]),
  transitions: pairs([
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8],
    [9, 10],
    [11, 12],
  ]),
  leaveReset: [5, 6, 11, 12, 14, 15],
};

const GRADER_CAB: CabConfig = {
  lastControl: 43,
  driveAnimation: 35,
  builtFlag: "graderBuilt",
  drivePedal: 17,
  keyOn: 34,
  keyOff: 33,
  controls: new Map([
    ...controls([15, 16, 17, 18, 25, 26, 27, 28], lever),
    ...controls([19, 20], { interval: LEVER_MS, sound: "lever" }),
    ...controls([21, 22, 23, 24], { interval: GADGET_MS, sound: "lever" }),
    ...controls([33, 34], gadget),
    ...controls([37, 38, 39, 40], { interval: LEVER_MS, sound: "btnclik2" }),
  ]),
  transitions: new Map([
    ...pairs([
      [15, 16],
      [17, 18],
      [19, 20],
      [21, 22],
      [23, 24],
      [25, 26],
      [27, 28],
      [33, 34],
      [37, 38],
      [39, 40],
      [5, 6],
      [7, 8],
      [11, 12],
    ]),
    [9, 7],
    [13, 11],
    [10, 5],
    [14, 5],
  ]),
  leaveReset: [17, 18, 33, 34],
};

const CONFIGS = new Map<number, CabConfig>([
  [71, MONSTER_CAB],
  [81, DOZER_CAB],
  [91, GRADER_CAB],
]);

interface CabState {
  engineRunning: boolean;
  bladeCurrent: number;
  bladeUp: boolean;
}

function stateFor(engine: Engine): CabState {
  return engine.state<CabState>(() => ({ engineRunning: false, bladeCurrent: 5, bladeUp: true }));
}

function configFor(engine: Engine): CabConfig {
  const config = CONFIGS.get(engine.moduleNumber);

  if (!config) {
    throw new Error(`No cab config for module ${engine.moduleNumber}`);
  }

  return config;
}

function isBladeLeverAllowed(engine: Engine, object: number): boolean {
  const blade = stateFor(engine);

  if (!blade.bladeUp) {
    return false;
  }

  if (object === 21 || object === 23) {
    return blade.bladeCurrent === 5;
  }

  if (object === 22) {
    return blade.bladeCurrent === 7;
  }

  return blade.bladeCurrent === 11;
}

function isGated(engine: Engine, object: number): boolean {
  const isTiltLever = engine.moduleNumber === 91 && object >= 21 && object <= 24;

  return isTiltLever && !isBladeLeverAllowed(engine, object);
}

async function clickAsync(engine: Engine, object: number): Promise<void> {
  const config = configFor(engine);
  const control = config.controls.get(object);

  if (engine.moduleNumber === 91 && object === 41) {
    await engine.sfx("horn");
    return;
  }

  if (!control) {
    return;
  }

  if (control.sound) {
    await engine.sfx(control.sound);
  }

  if (isGated(engine, object)) {
    return;
  }

  setKeyLamp(engine, object);
  engine.play(object, 2, false, control.interval);
}

function setKeyLamp(engine: Engine, object: number): void {
  if (engine.moduleNumber !== 81) {
    return;
  }

  if (object === 11) {
    engine.requireScene().setFrame(14, 1);
  }

  if (object === 12) {
    engine.requireScene().setFrame(14, 0);
  }
}

function driveOff(engine: Engine): void {
  const config = configFor(engine);
  const scene = engine.requireScene();

  for (let index = 1; index <= config.lastControl; index += 1) {
    engine.stopStream(index, "none");
    scene.setVisible(index, false);
  }

  scene.setFrame(OUTSIDE_VIEW, 1);
  engine.play(config.driveAnimation, 2, true);
}

function switchEngine(engine: Engine, object: number): void {
  const config = configFor(engine);

  if (object === config.keyOn) {
    stateFor(engine).engineRunning = true;
    engine.pushAmbient(ENGINE_LOOP);
    return;
  }

  if (object === config.keyOff) {
    stateFor(engine).engineRunning = false;
    engine.popAmbient();
  }
}

function moveBlade(engine: Engine, object: number): void {
  const blade = stateFor(engine);

  const bladeActions = new Map<number, () => void>([
    [
      19,
      () => {
        engine.play(blade.bladeCurrent, 2, false, LEVER_MS);
        blade.bladeUp = false;
      },
    ],
    [
      20,
      () => {
        engine.hide(blade.bladeCurrent);
        engine.play(blade.bladeCurrent + 1, 2, false, LEVER_MS);
        blade.bladeUp = true;
      },
    ],
    [21, () => tiltBlade(engine, 5, 9, 7)],
    [22, () => tiltBlade(engine, 7, 10, 5)],
    [23, () => tiltBlade(engine, 5, 13, 11)],
    [24, () => tiltBlade(engine, 11, 14, 5)],
  ]);

  bladeActions.get(object)?.();
}

function tiltBlade(engine: Engine, from: number, animation: number, to: number): void {
  const blade = stateFor(engine);

  engine.hide(from);
  engine.play(animation, 2, false, LEVER_MS);
  blade.bladeCurrent = to;
}

function dozerBlade(engine: Engine, object: number): void {
  if (object === 7) {
    engine.play(2, 2, true, LEVER_MS);
  }

  if (object === 8) {
    engine.play(1, 2, true, LEVER_MS);
  }
}

function finished(engine: Engine, object: number): void {
  const config = configFor(engine);

  if (object === config.driveAnimation) {
    engine.progress[config.builtFlag] = true;
    engine.goto(10).catch(() => undefined);
    return;
  }

  const partner = config.transitions.get(object);

  if (partner !== undefined) {
    engine.stopStream(object, "rewind");
    engine.showStart(partner);
  }

  switchEngine(engine, object);
  runModuleEffects(engine, object);

  const isRunning = stateFor(engine).engineRunning;

  if (object === config.drivePedal && isRunning) {
    driveOff(engine);
  }
}

function runModuleEffects(engine: Engine, object: number): void {
  if (engine.moduleNumber === 81) {
    dozerBlade(engine, object);
  }

  if (engine.moduleNumber === 91) {
    moveBlade(engine, object);
  }
}

function leave(engine: Engine): void {
  const config = configFor(engine);
  const scene = engine.requireScene();

  for (const index of config.leaveReset) {
    const initiallyVisible = scene.objects[index].def.raw.getUint32(0x10, true) !== 0;

    engine.stopStream(index, "rewind");
    scene.setVisible(index, initiallyVisible);
  }
}

export const cab: ModuleLogic = {
  click: (engine, object) => {
    clickAsync(engine, object).catch(() => undefined);
  },
  finished,
  leave,
  backTarget: (engine) => Math.floor(engine.moduleNumber / 10),
};
