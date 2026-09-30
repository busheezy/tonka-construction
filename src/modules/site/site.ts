import { readAttachPoints, type AttachPoint } from "../../engine/driving";
import type { Engine, ModuleLogic } from "../../engine/engine";
import { loadFile } from "../../engine/data";
import type { Scene } from "../../engine/scene";
import { animateTool, applyLoadPose, facesTarget, isNearTarget } from "../shared/tool";
import {
  bringSemi,
  isSemiEmpty,
  resetSemi,
  semiRoute,
  sendSemiAway,
  unlinkFromChain,
} from "../shared/delivery";

const ARROW_LEFT = 0;
const ARROW_RIGHT = 225;
const ARROW_TOP = 400;
const CRANE_ARROW_TOP = 350;
const ARROW_BOTTOM = 483;
const VEHICLE_PATH_MS = 40;
const PARK_X = 90;
const PARK_Y = 430;
const PARK_HEADING = 4;
const HOOK_DROP = 15;
const LOAD_EMPTY = 0;
const LOAD_SCOOPED = 1;
const LOAD_DUMPING = 2;
const LOAD_FULL = 3;
const LOAD_CARRYING = 4;
const LOAD_CARRIED = 5;
const SCOOP_PAIRS = [
  [0x28, 0x2c],
  [0x30, 0x34],
  [0x38, 0x3c],
  [0x40, 0x44],
  [0x48, 0x4c],
];
const HOOK_PAIR = [0x50, 0x54];

function targetOfLoad(raw: DataView): [number, number] {
  const targetX = raw.getInt16(0x7c, true);
  const targetY = raw.getInt16(0x7e, true);

  return [targetX, targetY];
}

export interface SiteState {
  vehicleOnSite: boolean;
  lastDriveIn: boolean;
  rotationVehicle: number;
  semiPresent: boolean;
  armDown: boolean;
  flags: Record<string, boolean>;
  lastIdle: number;
  unhookable: number[];
  dumpingVehicle: number;
}

export interface SiteScript {
  moduleNumber: number;
  flatbed: number;
  crane: number;
  dumpAnimation: number;
  craneQuips: number[];
  acceptsAnyDrop: boolean;
  chains: number[][];
  enter: (site: Site) => number | undefined;
  finished: (site: Site, object: number) => void;
  speechSkipped?: (site: Site, object: number) => boolean;
  vehicleArrived: (site: Site, vehicle: number) => void;
  vehicleLeft: (site: Site, vehicle: number) => void;
  semiArrived: (site: Site) => void;
  semiLeft: (site: Site) => void;
  vehicleMoved?: (site: Site, vehicle: number) => void;
  itemPicked?: (site: Site, item: number) => void;
  dropped: (site: Site, item: number) => boolean;
  scooped?: (site: Site, target: number) => void;
  workClick?: (site: Site, vehicle: number) => boolean;
  click?: (site: Site, object: number) => void;
  idle: (site: Site) => void;
  refusesVehicleCall?: (site: Site) => boolean;
}

export class Site {
  readonly engine: Engine;
  readonly script: SiteScript;
  private hookPoints: AttachPoint[] = [];
  private bucketPoints: AttachPoint[] = [];

  constructor(engine: Engine, script: SiteScript) {
    this.engine = engine;
    this.script = script;
  }

  get state(): SiteState {
    return this.engine.state<SiteState>(() => ({
      vehicleOnSite: false,
      lastDriveIn: false,
      rotationVehicle: -1,
      semiPresent: false,
      armDown: false,
      flags: {},
      lastIdle: -1,
      unhookable: [],
      dumpingVehicle: -1,
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

  allVisible(indices: number[]): boolean {
    return indices.every((index) => this.visible(index));
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

  playAt(index: number, x: number, y: number): void {
    this.scene.moveTo(index, x, y);
    this.engine.play(index, 2, true);
    this.scene.moveTo(index, x, y);
  }

  prime(index: number): void {
    this.engine.showStart(index);
  }

  setLayer(index: number, type: number): void {
    this.scene.objects[index].type = type;
    this.scene.buildDrawOrder();
  }

  flashArrows(): void {
    this.engine.setPaletteCycling(true);
  }

  randomQuip(choices: number[]): void {
    const pick = choices[this.engine.random(choices.length)];

    this.say(pick);
  }

  complete(activity: number): void {
    this.engine.progress.complete(activity);
  }

  async loadAttachPoints(): Promise<void> {
    const hooks = await loadFile("frames04.pos");
    const buckets = await loadFile("excavt.pos");

    this.hookPoints = readAttachPoints(hooks);
    this.bucketPoints = readAttachPoints(buckets);
  }

  hookPoint(vehicle: number): AttachPoint {
    const object = this.scene.objects[vehicle];
    const tools = Math.max(1, object.def.framesPerSet);
    const point = this.hookPoints[object.heading * tools + object.toolFrame] ?? { x: 0, y: 0 };

    return { x: object.left + point.x, y: object.top + point.y };
  }

  bucketPoint(vehicle: number): AttachPoint {
    const object = this.scene.objects[vehicle];
    const point = this.bucketPoints[object.heading] ?? { x: 0, y: 0 };

    return { x: object.left + point.x, y: object.top + point.y };
  }

  callVehicle(): void {
    const state = this.state;

    if (state.vehicleOnSite) {
      this.driveOut(state.rotationVehicle);
      return;
    }

    const refused = this.script.refusesVehicleCall?.(this) ?? false;

    if (refused) {
      return;
    }

    const next = this.nextRotationVehicle();

    if (next !== undefined) {
      this.driveIn(next);
    }
  }

  private nextRotationVehicle(): number | undefined {
    const scene = this.scene;
    const count = scene.objects.length;
    const start = this.state.rotationVehicle;

    for (let offset = 1; offset <= count; offset += 1) {
      const candidate = (start + offset + count) % count;
      const object = scene.objects[candidate];
      const isRotationVehicle =
        object.def.raw.getUint32(0x14, true) !== 0 && scene.isVehicle(candidate);

      if (isRotationVehicle) {
        return candidate;
      }
    }

    return undefined;
  }

  driveIn(vehicle: number): void {
    const scene = this.scene;
    const object = scene.objects[vehicle];
    const pathName = `path${this.script.moduleNumber}1.bin`;

    this.state.rotationVehicle = vehicle;
    this.engine.setPaletteCycling(false);
    scene.moveTo(vehicle, object.def.x, object.def.y);
    scene.setVisible(vehicle, true);
    this.engine.inputLocked = true;
    this.engine
      .runPath(vehicle, pathName, VEHICLE_PATH_MS, () => this.vehicleArrivedOnSite(vehicle))
      .catch(() => undefined);
  }

  private vehicleArrivedOnSite(vehicle: number): void {
    this.engine.inputLocked = false;
    this.state.vehicleOnSite = true;
    this.state.lastDriveIn = true;
    this.script.vehicleArrived(this, vehicle);
  }

  driveOut(vehicle: number): void {
    const scene = this.scene;
    const object = scene.objects[vehicle];
    const pathName = `path${this.script.moduleNumber}2.bin`;

    scene.moveTo(vehicle, PARK_X, PARK_Y);
    scene.setPose(vehicle, PARK_HEADING, object.loadSet, 0);
    this.carryLoad(vehicle);
    this.engine.inputLocked = true;
    this.engine
      .runPath(vehicle, pathName, VEHICLE_PATH_MS, () => this.vehicleLeftSite(vehicle))
      .catch(() => undefined);
  }

  private vehicleLeftSite(vehicle: number): void {
    const scene = this.scene;
    const object = scene.objects[vehicle];

    this.engine.inputLocked = false;
    this.state.vehicleOnSite = false;
    this.state.lastDriveIn = false;
    this.state.armDown = false;
    scene.moveTo(vehicle, object.def.x, object.def.y);
    this.carryLoad(vehicle);
    this.script.vehicleLeft(this, vehicle);
  }

  private get route() {
    return semiRoute(this.script.moduleNumber, this.script.flatbed);
  }

  bringFlatbed(chainStart: number, useReturnPath = false): void {
    bringSemi(this.engine, this.route, chainStart, useReturnPath, () => this.flatbedArrived());
  }

  private flatbedArrived(): void {
    this.state.semiPresent = true;
    this.script.semiArrived(this);
  }

  sendFlatbedAway(): void {
    sendSemiAway(this.engine, this.route, () => this.flatbedLeft());
  }

  private flatbedLeft(): void {
    this.state.semiPresent = false;
    resetSemi(this.engine, this.route);
    this.scene.setVisible(this.script.flatbed, false);
    this.script.semiLeft(this);
  }

  flatbedCarries(item: number): boolean {
    return this.scene.objects[this.script.flatbed].link === item;
  }

  unlink(item: number): void {
    unlinkFromChain(this.engine, item);
    this.leaveIfFlatbedEmpty();
  }

  private leaveIfFlatbedEmpty(): void {
    const isEmpty = isSemiEmpty(this.engine, this.script.flatbed);

    if (isEmpty && this.state.semiPresent) {
      this.state.semiPresent = false;
      this.sendFlatbedAway();
    }
  }

  toggleArm(vehicle: number): void {
    if (this.state.armDown) {
      this.raiseArm(vehicle);
      return;
    }

    this.lowerArm(vehicle);
  }

  lowerArm(vehicle: number): void {
    const load = this.scene.objects[vehicle].link;
    const loadOnTarget = load >= 0 && isNearTarget(this.engine, load);

    animateTool(
      this.engine,
      vehicle,
      true,
      () => this.carryLoad(vehicle),
      () => this.afterLower(vehicle, loadOnTarget),
    );
  }

  raiseArm(vehicle: number): void {
    animateTool(
      this.engine,
      vehicle,
      false,
      () => this.carryLoad(vehicle),
      () => this.afterRaise(vehicle),
    );
  }

  private afterLower(vehicle: number, loadOnTarget: boolean): void {
    const object = this.scene.objects[vehicle];

    this.state.armDown = true;

    if (object.link >= 0) {
      this.releaseHookedLoad(vehicle, object.link, loadOnTarget);
      return;
    }

    if (object.loadState === LOAD_FULL) {
      this.dump(vehicle);
      return;
    }

    if (object.loadState === LOAD_EMPTY) {
      this.touch(vehicle);
    }
  }

  private afterRaise(vehicle: number): void {
    const scene = this.scene;
    const object = scene.objects[vehicle];
    const nextState = new Map<number, number>([
      [LOAD_DUMPING, LOAD_EMPTY],
      [LOAD_SCOOPED, LOAD_FULL],
    ]).get(object.loadState);

    this.state.armDown = false;

    if (nextState !== undefined) {
      object.loadState = nextState;
    }

    applyLoadPose(this.engine, vehicle);
  }

  private releaseHookedLoad(vehicle: number, load: number, loadOnTarget: boolean): void {
    const scene = this.scene;
    const cargo = scene.objects[load];
    const [targetX, targetY] = targetOfLoad(cargo.def.raw);

    if (!loadOnTarget) {
      this.raiseArm(vehicle);
      return;
    }

    scene.moveTo(load, targetX, targetY);
    scene.setFrame(load, 0);
    cargo.loadState = LOAD_EMPTY;
    cargo.carrier = -1;
    scene.objects[vehicle].link = -1;
    scene.objects[vehicle].loadState = LOAD_DUMPING;
    this.state.unhookable.push(load);
    this.place(load);
    this.raiseArm(vehicle);
  }

  private dump(vehicle: number): void {
    const scene = this.scene;
    const object = scene.objects[vehicle];
    const bucket = this.bucketPoint(vehicle);
    const animation = this.script.dumpAnimation;

    object.loadState = LOAD_DUMPING;
    this.state.dumpingVehicle = vehicle;
    applyLoadPose(this.engine, vehicle);
    this.engine.play(animation, 2, false);
    scene.moveTo(animation, bucket.x, bucket.y);
  }

  dumpFinished(): void {
    const vehicle = this.state.dumpingVehicle;

    if (vehicle < 0) {
      return;
    }

    this.state.dumpingVehicle = -1;
    this.raiseArm(vehicle);
  }

  private touchCandidates(vehicle: number): number[] {
    const scene = this.scene;
    const topmostFirst = [...scene.drawOrder].reverse();

    return topmostFirst.filter((index) => {
      const object = scene.objects[index];
      const isOther = index !== vehicle && object.visible;

      return isOther && scene.overlaps(vehicle, index) && facesTarget(this.engine, vehicle, index);
    });
  }

  private touch(vehicle: number): void {
    const scene = this.scene;
    const candidates = this.touchCandidates(vehicle);
    const scoopTarget = candidates.find((index) => this.isScoopPair(vehicle, index));
    const hookTarget = candidates.find((index) => this.isHookPair(vehicle, index));

    if (scoopTarget !== undefined) {
      this.scoop(vehicle, scoopTarget);
      return;
    }

    if (hookTarget !== undefined) {
      this.hook(vehicle, hookTarget);
      return;
    }

    scene.objects[vehicle].loadState = LOAD_EMPTY;
  }

  private isScoopPair(vehicle: number, target: number): boolean {
    const scene = this.scene;

    return SCOOP_PAIRS.some(
      ([moverFlag, targetFlag]) => scene.flag(vehicle, moverFlag) && scene.flag(target, targetFlag),
    );
  }

  private isHookPair(vehicle: number, target: number): boolean {
    const scene = this.scene;
    const [moverFlag, targetFlag] = HOOK_PAIR;
    const isHookable = !this.state.unhookable.includes(target);

    return isHookable && scene.flag(vehicle, moverFlag) && scene.flag(target, targetFlag);
  }

  private scoop(vehicle: number, target: number): void {
    const scene = this.scene;
    const object = scene.objects[target];
    const nextStep = object.step + 1;

    object.step = nextStep;

    if (nextStep >= Math.max(1, object.def.frameCount)) {
      scene.setVisible(target, false);
      this.script.finished(this, target);
    } else {
      scene.setFrame(target, nextStep);
    }

    scene.objects[vehicle].loadState = LOAD_SCOOPED;
    applyLoadPose(this.engine, vehicle);
    this.script.scooped?.(this, target);
    this.raiseArm(vehicle);
  }

  private hook(vehicle: number, target: number): void {
    const scene = this.scene;

    this.unlink(target);
    scene.objects[vehicle].loadState = LOAD_CARRYING;
    scene.objects[vehicle].link = target;
    scene.objects[target].loadState = LOAD_CARRIED;
    scene.objects[target].carrier = vehicle;
    this.setLayer(target, 1);
    this.script.itemPicked?.(this, target);
    this.raiseArm(vehicle);
  }

  bump(target: number, mover: number): void {
    const scene = this.scene;
    const isHeldVehicle = mover === scene.heldObject && scene.isVehicle(mover);
    const isEmpty = scene.objects[mover].loadState === LOAD_EMPTY;
    const canWork = isHeldVehicle && isEmpty && this.state.armDown && !this.engine.inputLocked;

    if (!canWork || !facesTarget(this.engine, mover, target)) {
      return;
    }

    if (this.isScoopPair(mover, target)) {
      this.scoop(mover, target);
      return;
    }

    if (this.isHookPair(mover, target)) {
      this.hook(mover, target);
    }
  }

  carryLoad(vehicle: number): void {
    const scene = this.scene;
    const object = scene.objects[vehicle];
    const load = object.link;

    if (load < 0 || object.loadState !== LOAD_CARRYING) {
      return;
    }

    const cargo = scene.objects[load];
    const hook = this.hookPoint(vehicle);
    const cargoHeight = cargo.image?.height ?? 0;
    const cargoY = hook.y - HOOK_DROP + (cargoHeight >> 1);

    scene.moveTo(load, hook.x, cargoY);
  }

  place(item: number): void {
    const handled = this.script.dropped(this, item);

    if (handled) {
      return;
    }

    this.activatePartner(item);
    this.craneQuip();
  }

  activatePartner(item: number): void {
    const scene = this.scene;
    const partner = item - 1;
    const partnerObject = scene.objects[partner];
    const itemObject = scene.objects[item];

    scene.setVisible(item, false);

    if (!partnerObject.def.streamed) {
      scene.setVisible(partner, true);
      return;
    }

    const primesOnly = partnerObject.def.raw.getUint16(0x68, true) === 2;

    if (primesOnly) {
      this.prime(partner);
      return;
    }

    if (partnerObject.looping) {
      this.startLoopAt(partner, itemObject.left, itemObject.top);
      return;
    }

    this.engine.play(partner, 2, true);
  }

  private startLoopAt(partner: number, left: number, top: number): void {
    const scene = this.scene;
    const firstChunk = scene.objects[partner].chunks?.[0];
    const offsetX = firstChunk?.offsetX ?? 0;
    const offsetY = firstChunk?.offsetY ?? 0;

    scene.moveTo(partner, left - offsetX, top - offsetY);
    this.engine.play(partner, 2, false);
    scene.moveTo(partner, left - offsetX, top - offsetY);
  }

  private craneQuip(): void {
    const held = this.scene.heldObject;
    const quips = this.script.craneQuips;

    if (held !== this.script.crane || quips.length === 0 || this.engine.speechBusy) {
      return;
    }

    this.randomQuip(quips);
  }

  isInArrow(x: number, y: number): boolean {
    const held = this.scene.heldObject;
    const top = held === this.script.crane ? CRANE_ARROW_TOP : ARROW_TOP;

    return x > ARROW_LEFT && x < ARROW_RIGHT && y > top && y < ARROW_BOTTOM;
  }

  parkHeldVehicle(vehicle: number): void {
    this.engine.release();
    this.driveOut(vehicle);
  }

  pickIdle(choices: number[]): number {
    const available = choices.filter((choice) => choice !== this.state.lastIdle);
    const pick = available[this.engine.random(available.length)] ?? choices[0];

    this.state.lastIdle = pick;

    return pick;
  }
}

function dropItem(site: Site, item: number): void {
  const scene = site.scene;
  const object = scene.objects[item];
  const targetX = object.def.raw.getInt16(0x7c, true);
  const targetY = object.def.raw.getInt16(0x7e, true);
  const width = object.image?.width ?? 0;
  const height = object.image?.height ?? 0;
  const isClose = Math.abs(object.x - targetX) < width && Math.abs(object.y - targetY) < height;
  const acceptsAnywhere = targetX < 0 && site.script.acceptsAnyDrop;

  if (acceptsAnywhere) {
    site.engine.release();
    site.place(item);
    return;
  }

  if (targetX <= 0 || !isClose) {
    site.engine.release();
    return;
  }

  scene.moveTo(item, targetX, targetY);
  site.engine.release();
  site.place(item);
}

function heldVehicleClick(site: Site, vehicle: number): void {
  const object = site.scene.objects[vehicle];
  const inArrow = site.isInArrow(object.x, object.y);

  if (inArrow && !site.state.semiPresent) {
    site.parkHeldVehicle(vehicle);
    return;
  }

  const workedHandled = site.script.workClick?.(site, vehicle) ?? false;

  if (workedHandled) {
    return;
  }

  site.toggleArm(vehicle);
}

function pickUp(site: Site, object: number): void {
  const scene = site.scene;
  const isChainItem = scene.objects[object].carrier >= 0;

  if (isChainItem) {
    site.unlink(object);
  }

  if (!scene.isVehicle(object) && scene.objects[object].def.headings <= 1) {
    site.setLayer(object, 1);
  }

  site.script.itemPicked?.(site, object);
}

function linkChain(scene: Scene, chain: number[]): void {
  chain.forEach((member, position) => {
    const object = scene.objects[member];
    const next = chain[position + 1] ?? -1;
    const previous = chain[position - 1] ?? -1;

    object.link = next;
    object.carrier = previous;
  });
}

function linkChains(scene: Scene, chains: number[][]): void {
  for (const chain of chains) {
    linkChain(scene, chain);
  }
}

function hitsGrabbable(site: Site, x: number, y: number): boolean {
  const scene = site.scene;
  const hit = scene.hitTest(x, y);

  if (hit === undefined) {
    return false;
  }

  return scene.objects[hit].grabbable;
}

function isDumpAnimation(site: Site, object: number): boolean {
  return object === site.script.dumpAnimation;
}

export function createSiteLogic(script: SiteScript): ModuleLogic {
  const sites = new WeakMap<Engine, Site>();

  function siteFor(engine: Engine): Site {
    const existing = sites.get(engine);

    if (existing) {
      return existing;
    }

    const created = new Site(engine, script);

    sites.set(engine, created);

    return created;
  }

  return {
    enter: (engine) => {
      const site = siteFor(engine);

      site.state.semiPresent = site.visible(script.flatbed) && site.state.semiPresent;
      site.loadAttachPoints().catch(() => undefined);

      return script.enter(site);
    },
    worldClick: (engine, x, y) => {
      const site = siteFor(engine);
      const inArrow = site.isInArrow(x, y);
      const callsVehicle = inArrow && !hitsGrabbable(site, x, y);

      if (callsVehicle) {
        site.callVehicle();
      }

      return callsVehicle;
    },
    heldClick: (engine, held) => {
      const site = siteFor(engine);

      if (site.scene.isVehicle(held)) {
        heldVehicleClick(site, held);
        return;
      }

      dropItem(site, held);
    },
    pickUp: (engine, object) => pickUp(siteFor(engine), object),
    freshScene: (scene) => linkChains(scene, script.chains),
    bump: (engine, target, mover) => siteFor(engine).bump(target, mover),
    vehicleMoved: (engine, vehicle) => {
      const site = siteFor(engine);

      site.carryLoad(vehicle);
      script.vehicleMoved?.(site, vehicle);
    },
    finished: (engine, object) => {
      const site = siteFor(engine);

      if (isDumpAnimation(site, object)) {
        site.dumpFinished();
        return;
      }

      script.finished(site, object);
    },
    speechEnded: (engine, object) => {
      const site = siteFor(engine);
      const handled = script.speechSkipped?.(site, object) ?? false;

      if (!handled) {
        script.finished(site, object);
      }
    },
    click: (engine, object) => script.click?.(siteFor(engine), object),
    idle: (engine) => script.idle(siteFor(engine)),
  };
}
