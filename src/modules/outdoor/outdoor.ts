import { readAttachPoints, type AttachPoint } from "../../engine/driving";
import type { Engine, ModuleLogic } from "../../engine/engine";
import { loadFile } from "../../engine/data";
import {
  bringSemi,
  isSemiEmpty,
  resetSemi,
  semiRoute,
  sendSemiAway,
  unlinkFromChain,
} from "../shared/delivery";
import { animateTool, applyLoadPose, facesTarget, isNearTarget, targetOf } from "../shared/tool";

const LOAD_EMPTY = 0;
const LOAD_SCOOPED = 1;
const LOAD_DUMPING = 2;
const LOAD_FULL = 3;
const LOAD_CARRYING = 4;
const LOAD_CARRIED = 5;
const WORK_PAIRS = [
  [0x28, 0x2c],
  [0x30, 0x34],
  [0x38, 0x3c],
  [0x40, 0x44],
  [0x48, 0x4c],
];
const CARRY_FLAG = 0x50;
const CARRYABLE_FLAG = 0x54;
const PUSH_FLAG = 0x20;
const PUSHABLE_FLAG = 0x24;
const PUSH_FACTOR = 3;
const HOOK_DROP = 15;
const HEADER_RECTS = 0x60;
const TRAIN_SPLIT_X = 760;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OutdoorState {
  toolDown: boolean;
  flags: Record<string, boolean>;
  lastIdle: number;
  semiPresent: boolean;
  unhookable: number[];
  currentVehicle: number;
}

export interface OutdoorScript {
  moduleNumber: number;
  semi?: number;
  puffAnimation: number;
  pictures?: Map<number, number>;
  helicopter?: number;
  enter: (outdoor: Outdoor) => number | undefined;
  finished: (outdoor: Outdoor, object: number) => void;
  speechSkipped?: (outdoor: Outdoor, object: number) => boolean;
  bump?: (outdoor: Outdoor, target: number, mover: number) => boolean;
  worked?: (outdoor: Outdoor, target: number, mover: number) => void;
  scooped?: (outdoor: Outdoor, target: number, vehicle: number) => void;
  dumped?: (outdoor: Outdoor, vehicle: number, under: number | undefined) => boolean;
  vehicleClick?: (outdoor: Outdoor, vehicle: number) => boolean;
  vehicleMoved?: (outdoor: Outdoor, vehicle: number) => void;
  axisLock?: (outdoor: Outdoor, vehicle: number, dx: number) => number;
  picturePicked?: (outdoor: Outdoor, picture: number) => void;
  pictureReturned?: (outdoor: Outdoor, picture: number) => void;
  itemPicked?: (outdoor: Outdoor, item: number) => void;
  itemDropped?: (outdoor: Outdoor, item: number) => void;
  dragItem?: (outdoor: Outdoor, item: number, x: number, y: number) => boolean;
  loadPlaced?: (outdoor: Outdoor, load: number) => void;
  semiArrived?: (outdoor: Outdoor) => void;
  semiLeft?: (outdoor: Outdoor) => void;
  worldClick?: (outdoor: Outdoor, x: number, y: number) => boolean;
  click?: (outdoor: Outdoor, object: number) => void;
  idle?: (outdoor: Outdoor) => void;
}

export class Outdoor {
  readonly engine: Engine;
  readonly script: OutdoorScript;
  private dumpPoints: AttachPoint[] = [];
  private hookPoints: AttachPoint[] = [];

  constructor(engine: Engine, script: OutdoorScript) {
    this.engine = engine;
    this.script = script;
  }

  get state(): OutdoorState {
    return this.engine.state<OutdoorState>(() => ({
      toolDown: false,
      flags: {},
      lastIdle: -1,
      semiPresent: true,
      unhookable: [],
      currentVehicle: -1,
    }));
  }

  get scene() {
    return this.engine.requireScene();
  }

  flag(name: string): boolean {
    return this.state.flags[name] ?? false;
  }

  setFlag(name: string, value = true): void {
    this.state.flags[name] = value;
  }

  visible(index: number): boolean {
    return this.scene.objects[index].visible;
  }

  allHidden(indices: number[]): boolean {
    return indices.every((index) => !this.visible(index));
  }

  show(...indices: number[]): void {
    for (const index of indices) {
      this.engine.show(index);
    }
  }

  hide(...indices: number[]): void {
    for (const index of indices) {
      this.engine.hide(index);
    }
  }

  say(index: number): void {
    this.engine.play(index, 2, true);
  }

  prime(index: number): void {
    this.engine.showStart(index);
  }

  rewind(index: number): void {
    this.engine.stopStream(index, "rewind");
  }

  lock(): void {
    this.engine.inputLocked = true;
  }

  unlock(): void {
    this.engine.inputLocked = false;
  }

  sfx(slot: number): void {
    this.engine.audio.playWav(`sfx${slot}.wav`).catch(() => undefined);
  }

  chance(percent: number): boolean {
    return this.engine.random(100) < percent;
  }

  pick(first: number, count: number): number {
    return first + this.engine.random(count);
  }

  setLayer(index: number, type: number): void {
    this.scene.objects[index].type = type;
    this.scene.buildDrawOrder();
  }

  complete(activity: number): void {
    this.engine.progress.complete(activity);
  }

  headerRect(index: number): Rect {
    const raw = this.scene.module.header.raw;
    const base = HEADER_RECTS + index * 16;
    const left = raw.getInt32(base, true);
    const top = raw.getInt32(base + 4, true);
    const right = raw.getInt32(base + 8, true);
    const bottom = raw.getInt32(base + 12, true);

    return { left, top, right, bottom };
  }

  async loadAttachPoints(): Promise<void> {
    const dumpBytes = await loadFile("fload.pos");
    const hookBytes = await loadFile("frames02.pos");

    this.dumpPoints = readAttachPoints(dumpBytes);
    this.hookPoints = readAttachPoints(hookBytes);
  }

  private get route() {
    return semiRoute(this.script.moduleNumber, this.script.semi ?? 0);
  }

  bringSemi(chainStart: number): void {
    bringSemi(this.engine, this.route, chainStart, false, () => this.semiArrived());
  }

  private semiArrived(): void {
    this.state.semiPresent = true;
    this.script.semiArrived?.(this);
  }

  sendSemiAway(): void {
    this.state.semiPresent = false;
    sendSemiAway(this.engine, this.route, () => this.semiLeft());
  }

  private semiLeft(): void {
    resetSemi(this.engine, this.route);
    this.script.semiLeft?.(this);
  }

  semiCarries(item: number): boolean {
    const semi = this.script.semi;

    return semi !== undefined && this.scene.objects[semi].link === item;
  }

  unlink(item: number): void {
    const semi = this.script.semi;

    unlinkFromChain(this.engine, item);

    if (semi === undefined || !this.state.semiPresent) {
      return;
    }

    if (isSemiEmpty(this.engine, semi)) {
      this.sendSemiAway();
    }
  }

  toggleTool(vehicle: number): void {
    if (this.state.toolDown) {
      this.raiseTool(vehicle);
      return;
    }

    animateTool(
      this.engine,
      vehicle,
      true,
      () => this.carry(vehicle, 0, 0),
      () => this.afterLower(vehicle),
    );
  }

  raiseTool(vehicle: number): void {
    animateTool(
      this.engine,
      vehicle,
      false,
      () => this.carry(vehicle, 0, 0),
      () => this.afterRaise(vehicle),
    );
  }

  private afterLower(vehicle: number): void {
    const object = this.scene.objects[vehicle];

    this.state.toolDown = true;

    if (object.link >= 0) {
      this.lowerCargo(vehicle, object.link);
      return;
    }

    if (object.loadState === LOAD_FULL || object.loadState === LOAD_CARRYING) {
      object.loadState = LOAD_DUMPING;
    }

    applyLoadPose(this.engine, vehicle);
    this.workAfterLower(vehicle);
  }

  private afterRaise(vehicle: number): void {
    const object = this.scene.objects[vehicle];

    this.state.toolDown = false;

    if (object.loadState === LOAD_DUMPING) {
      object.loadState = LOAD_EMPTY;
    } else if (object.loadState === LOAD_SCOOPED) {
      object.loadState = LOAD_FULL;
    }

    applyLoadPose(this.engine, vehicle);
  }

  private workAfterLower(vehicle: number): void {
    const object = this.scene.objects[vehicle];

    if (object.loadState === LOAD_EMPTY) {
      this.touch(vehicle);
      return;
    }

    if (object.loadState === LOAD_DUMPING) {
      this.dump(vehicle);
    }
  }

  private touch(vehicle: number): void {
    const scene = this.scene;
    const object = scene.objects[vehicle];
    const image = object.image;

    if (!image) {
      return;
    }

    const hit = scene.collide(vehicle, object.x, object.y, image, this.script.moduleNumber);

    if (hit !== undefined) {
      this.bump(hit, vehicle, 0, 0);
    }
  }

  private objectUnder(vehicle: number): number | undefined {
    const scene = this.scene;
    const object = scene.objects[vehicle];
    const image = object.image;

    if (!image) {
      return undefined;
    }

    return scene.collide(vehicle, object.x, object.y, image, this.script.moduleNumber);
  }

  private dump(vehicle: number): void {
    const scene = this.scene;
    const isCarrier = scene.flag(vehicle, CARRY_FLAG);

    if (isCarrier) {
      this.raiseTool(vehicle);
      return;
    }

    const under = this.objectUnder(vehicle);
    const skipsPuff = this.script.dumped?.(this, vehicle, under) ?? false;

    if (skipsPuff) {
      this.raiseTool(vehicle);
      return;
    }

    this.playPuff(vehicle);
  }

  private playPuff(vehicle: number): void {
    const scene = this.scene;
    const object = scene.objects[vehicle];
    const point = this.dumpPoints[object.heading] ?? { x: 0, y: 0 };
    const puff = this.script.puffAnimation;
    const x = object.left + point.x;
    const y = object.top + point.y;

    scene.moveTo(puff, x, y);
    this.engine.play(puff, 2, false);
    scene.moveTo(puff, x, y);
  }

  puffFinished(): void {
    const held = this.scene.heldObject;

    if (held !== undefined) {
      this.raiseTool(held);
    }
  }

  private lowerCargo(vehicle: number, cargo: number): void {
    const scene = this.scene;
    const vehicleObject = scene.objects[vehicle];

    if (!isNearTarget(this.engine, cargo)) {
      this.raiseTool(vehicle);
      return;
    }

    const [targetX, targetY] = targetOf(this.engine, cargo);

    scene.moveTo(cargo, targetX, targetY);
    scene.setFrame(cargo, 0);
    scene.objects[cargo].loadState = LOAD_EMPTY;
    scene.objects[cargo].carrier = -1;
    this.state.unhookable.push(cargo);
    vehicleObject.link = -1;
    vehicleObject.loadState = LOAD_DUMPING;
    this.installCargo(cargo);
    this.raiseTool(vehicle);
  }

  private installCargo(cargo: number): void {
    const scene = this.scene;
    const partner = cargo - 1;

    scene.setVisible(cargo, false);

    if (scene.objects[partner].def.streamed) {
      this.engine.play(partner, 2, true);
    } else {
      scene.setVisible(partner, true);
    }

    this.script.loadPlaced?.(this, cargo);
  }

  carry(vehicle: number, dx: number, dy: number): void {
    const scene = this.scene;
    const object = scene.objects[vehicle];
    const cargo = object.link;

    if (cargo < 0 || object.loadState !== LOAD_CARRYING) {
      return;
    }

    const tools = Math.max(1, object.def.framesPerSet);
    const point = this.hookPoints[object.heading * tools + object.toolFrame] ?? { x: 0, y: 0 };
    const x = object.left + point.x + dx;
    const y = object.top + point.y + dy - HOOK_DROP;
    const facesViewer = object.heading >= 5 && object.heading <= 7;

    scene.moveTo(cargo, x, y);
    scene.objects[cargo].type = facesViewer ? 2 : 1;
    scene.buildDrawOrder();
  }

  bump(target: number, mover: number, dx: number, dy: number): void {
    const scene = this.scene;

    if (this.engine.speechBusy) {
      return;
    }

    const handledByScene = this.script.bump?.(this, target, mover) ?? false;
    const isHeldMover = mover === scene.heldObject;

    if (handledByScene || !isHeldMover || !this.canWork(target, mover)) {
      return;
    }

    this.work(target, mover, dx, dy);
  }

  private canWork(target: number, mover: number): boolean {
    const scene = this.scene;
    const moverObject = scene.objects[mover];
    const needsToolDown = moverObject.def.framesPerSet > 1 && !this.state.toolDown;

    if (needsToolDown) {
      return false;
    }

    if (!scene.isVehicle(mover)) {
      return true;
    }

    return facesTarget(this.engine, mover, target);
  }

  private isWorkPair(target: number, mover: number): boolean {
    const scene = this.scene;

    return WORK_PAIRS.some(
      ([moverFlag, targetFlag]) => scene.flag(mover, moverFlag) && scene.flag(target, targetFlag),
    );
  }

  private isCarryPair(target: number, mover: number): boolean {
    const scene = this.scene;
    const isHookable = !this.state.unhookable.includes(target);

    return isHookable && scene.flag(mover, CARRY_FLAG) && scene.flag(target, CARRYABLE_FLAG);
  }

  private work(target: number, mover: number, dx: number, dy: number): void {
    const scene = this.scene;
    const moverObject = scene.objects[mover];
    const isEmpty = moverObject.loadState === LOAD_EMPTY;

    if (isEmpty && this.isWorkPair(target, mover)) {
      this.advanceTarget(target, mover);
      return;
    }

    if (isEmpty && this.isCarryPair(target, mover)) {
      this.hookCargo(target, mover);
      return;
    }

    const isPush =
      scene.flag(target, PUSHABLE_FLAG) && scene.flag(mover, PUSH_FLAG) && !this.engine.reversing;

    if (isPush) {
      this.push(target, dx, dy);
    }
  }

  private advanceTarget(target: number, mover: number): void {
    const scene = this.scene;
    const targetObject = scene.objects[target];
    const moverObject = scene.objects[mover];
    const nextStep = targetObject.step + 1;
    const stageCount = Math.max(1, targetObject.def.frameCount);
    const isLoader = moverObject.def.sets >= 2;
    const hasTool = moverObject.def.framesPerSet >= 2;

    targetObject.step = nextStep;

    if (nextStep >= stageCount) {
      this.clearTarget(target, stageCount);
    } else {
      scene.setFrame(target, nextStep);
    }

    this.script.worked?.(this, target, mover);

    if (isLoader) {
      moverObject.loadState = LOAD_SCOOPED;
    }

    if (isLoader || hasTool) {
      this.autoRaise(target, mover);
    }
  }

  private clearTarget(target: number, stageCount: number): void {
    const scene = this.scene;
    const targetObject = scene.objects[target];

    targetObject.step = stageCount - 1;

    if (!targetObject.keepLastFrame) {
      scene.setVisible(target, false);
    }

    this.script.finished(this, target);
  }

  private autoRaise(target: number, mover: number): void {
    applyLoadPose(this.engine, mover);
    this.script.scooped?.(this, target, mover);
    this.raiseTool(mover);
  }

  private hookCargo(target: number, mover: number): void {
    const scene = this.scene;

    this.unlink(target);
    scene.objects[target].loadState = LOAD_CARRIED;
    scene.objects[target].carrier = mover;
    scene.objects[mover].loadState = LOAD_CARRYING;
    scene.objects[mover].link = target;
    this.setLayer(target, 1);
    this.raiseTool(mover);
  }

  private push(target: number, dx: number, dy: number): void {
    const scene = this.scene;
    const object = scene.objects[target];
    const newX = object.x + dx * PUSH_FACTOR;
    const newY = object.y + dy * PUSH_FACTOR;
    const image = object.image;

    scene.moveTo(target, newX, newY);

    if (!image) {
      return;
    }

    const hit = scene.collide(target, newX, newY, image, this.script.moduleNumber);
    const isOtherObject = hit !== undefined && hit > 0 && hit !== scene.heldObject;

    if (isOtherObject) {
      this.script.bump?.(this, hit, target);
    }
  }

  trainRectFor(x: number): Rect {
    const index = x < TRAIN_SPLIT_X ? 3 : 4;

    return this.headerRect(index);
  }

  takeOffTrain(picture: number): void {
    const scene = this.scene;
    const vehicle = this.script.pictures?.get(picture);

    if (vehicle === undefined) {
      return;
    }

    const vehicleObject = scene.objects[vehicle];
    const loop = vehicle === this.script.helicopter ? "snds/hlicptr.wav" : "sfx2.wav";

    scene.moveTo(vehicle, vehicleObject.def.x, vehicleObject.def.y);
    scene.setPose(vehicle, vehicleObject.def.initialFrame, 0, 0);
    scene.setVisible(picture, false);
    this.engine.hold(vehicle);
    this.sfx(1);
    this.engine.pushAmbient(loop);
  }

  private pictureFor(vehicle: number): number | undefined {
    const pairs = [...(this.script.pictures ?? new Map<number, number>()).entries()];
    const pair = pairs.find(([, paired]) => paired === vehicle);

    return pair?.[0];
  }

  putBackOnTrain(vehicle: number): void {
    const scene = this.scene;
    const picture = this.pictureFor(vehicle);

    if (picture === undefined) {
      return;
    }

    const vehicleObject = scene.objects[vehicle];
    const x = vehicleObject.x;
    const y = vehicleObject.y;

    this.engine.release();
    scene.moveTo(vehicle, vehicleObject.def.x, vehicleObject.def.y);
    scene.setPose(vehicle, vehicleObject.def.initialFrame, 0, 0);
    scene.setVisible(vehicle, false);
    scene.moveTo(picture, x, y);
    this.state.toolDown = false;
    this.engine.hold(picture);
    this.sfx(3);
    this.engine.popAmbient();
  }

  pickIdle(choices: number[]): number {
    const available = choices.filter((choice) => choice !== this.state.lastIdle);
    const pick = available[this.engine.random(available.length)] ?? choices[0];

    this.state.lastIdle = pick;

    return pick;
  }
}

function isInside(rect: Rect, x: number, y: number): boolean {
  return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
}

function isPicture(outdoor: Outdoor, object: number): boolean {
  return outdoor.script.pictures?.has(object) ?? false;
}

function dragPicture(outdoor: Outdoor, picture: number, x: number, y: number): boolean {
  const object = outdoor.scene.objects[picture];
  const rect = outdoor.trainRectFor(object.def.x);
  const leavesSideways = x <= rect.left || x >= rect.right;
  const leavesDownward = y >= rect.bottom;

  if (leavesDownward) {
    outdoor.takeOffTrain(picture);
    return false;
  }

  return !leavesSideways;
}

function returnsToTrain(outdoor: Outdoor, vehicle: number): boolean {
  const scene = outdoor.scene;
  const object = scene.objects[vehicle];
  const hasPicture = [...(outdoor.script.pictures?.values() ?? [])].includes(vehicle);
  const isCarrying = object.link >= 1;

  if (!hasPicture || isCarrying) {
    return false;
  }

  const inStrip =
    isInside(outdoor.headerRect(3), object.x, object.y) ||
    isInside(outdoor.headerRect(4), object.x, object.y);

  return inStrip;
}

function vehicleMoved(outdoor: Outdoor, vehicle: number, dx: number, dy: number): void {
  outdoor.carry(vehicle, dx, dy);

  if (returnsToTrain(outdoor, vehicle)) {
    outdoor.putBackOnTrain(vehicle);
    return;
  }

  outdoor.script.vehicleMoved?.(outdoor, vehicle);
}

function heldClick(outdoor: Outdoor, held: number): void {
  const scene = outdoor.scene;

  if (scene.isVehicle(held)) {
    const handled = outdoor.script.vehicleClick?.(outdoor, held) ?? false;

    if (!handled) {
      outdoor.toggleTool(held);
    }

    return;
  }

  if (isPicture(outdoor, held)) {
    const def = scene.objects[held].def;

    scene.moveTo(held, def.x, def.y);
    outdoor.engine.release();
    outdoor.script.pictureReturned?.(outdoor, held);
    outdoor.engine.armIdle();
    return;
  }

  outdoor.engine.release();
  outdoor.script.itemDropped?.(outdoor, held);
}

function pickUp(outdoor: Outdoor, object: number): void {
  const scene = outdoor.scene;

  if (isPicture(outdoor, object)) {
    outdoor.script.picturePicked?.(outdoor, object);
    return;
  }

  if (scene.objects[object].carrier >= 0) {
    outdoor.unlink(object);
  }

  if (!scene.isVehicle(object)) {
    outdoor.setLayer(object, 1);
  }

  outdoor.script.itemPicked?.(outdoor, object);
}

export function createOutdoorLogic(script: OutdoorScript): ModuleLogic {
  const outdoors = new WeakMap<Engine, Outdoor>();

  function outdoorFor(engine: Engine): Outdoor {
    const existing = outdoors.get(engine);

    if (existing) {
      return existing;
    }

    const created = new Outdoor(engine, script);

    outdoors.set(engine, created);

    return created;
  }

  return {
    enter: (engine) => {
      const outdoor = outdoorFor(engine);

      outdoor.loadAttachPoints().catch(() => undefined);

      if (script.semi !== undefined) {
        outdoor.state.semiPresent = outdoor.visible(script.semi);
      }

      return script.enter(outdoor);
    },
    worldClick: (engine, x, y) => script.worldClick?.(outdoorFor(engine), x, y) ?? false,
    heldClick: (engine, held) => heldClick(outdoorFor(engine), held),
    pickUp: (engine, object) => pickUp(outdoorFor(engine), object),
    dragMove: (engine, held, x, y) => {
      const outdoor = outdoorFor(engine);

      if (isPicture(outdoor, held)) {
        return dragPicture(outdoor, held, x, y);
      }

      return script.dragItem?.(outdoor, held, x, y) ?? true;
    },
    axisLock: (engine, vehicle, dx) => script.axisLock?.(outdoorFor(engine), vehicle, dx) ?? dx,
    bump: (engine, target, mover, dx, dy) => outdoorFor(engine).bump(target, mover, dx, dy),
    vehicleMoved: (engine, vehicle, dx, dy) => vehicleMoved(outdoorFor(engine), vehicle, dx, dy),
    finished: (engine, object) => {
      const outdoor = outdoorFor(engine);

      if (object === script.puffAnimation) {
        outdoor.puffFinished();
        return;
      }

      script.finished(outdoor, object);
    },
    speechEnded: (engine, object) => {
      const outdoor = outdoorFor(engine);
      const handled = script.speechSkipped?.(outdoor, object) ?? false;

      if (!handled) {
        script.finished(outdoor, object);
      }
    },
    click: (engine, object) => script.click?.(outdoorFor(engine), object),
    idle: (engine) => script.idle?.(outdoorFor(engine)),
  };
}
