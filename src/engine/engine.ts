import { parseModule } from "../formats/module";
import { parsePcx } from "../formats/pcx";
import { PeImage } from "../formats/pe";
import { AudioEngine, type PlayingSound } from "./audio";
import { hasFile, loadFile } from "./data";
import { ACTIVITY_GARAGE, Progress } from "./progress";
import { readPath, readShorts, sectorFor, steer } from "./driving";
import { Framebuffer } from "./framebuffer";
import { Input } from "./input";
import { Scene, type SceneObject, type SceneSnapshot } from "./scene";
import { TimerScheduler } from "./timers";
import {
  handleToolbarClick,
  isActivityModule,
  isToolbarModal,
  linkSound,
  resetToolbar,
  setHudVisible,
} from "./toolbar";

export const STREAM_INTERVAL_MS = 125;
const IDLE_TIMER_ID = 999;
const IDLE_INTERVAL_MS = 1000;
const IDLE_LIMIT = 15;
const PALETTE_TIMER_ID = 0x386;
const PALETTE_INTERVAL_MS = 55;
const PAN_TIMER_ID = 0x385;
const PAN_INTERVAL_MS = 165;
const EDGE_SCROLL_MARGIN = 20;
const EDGE_SCROLL_STEP = 10;
const EDGE_SCROLL_INTERVAL_MS = 18;
const BLINK_INTERVAL_MS = 90;
const BLINK_TOGGLES = 12;
const BACK_RECT_COUNT = 3;
const DRIVE_INTERVAL_MS = 25;
const MAX_PENDING_MOTION = 64;
const DRAG_SCROLL_MARGIN = 100;
const PATH_TIMER_BASE = 2000;
const BACK_RECT_OFFSET = 0x60;

export interface SaveGame {
  moduleNumber?: number;
  playerName: string;
  progress: Progress;
  scenes: Record<number, SceneSnapshot>;
  states: Record<number, unknown>;
}

export interface ModuleLogic {
  enter?: (engine: Engine) => number | undefined | void;
  click?: (engine: Engine, object: number) => void;
  beforeLink?: (engine: Engine, object: number) => void;
  blocksLinks?: (engine: Engine) => boolean;
  linkSound?: (engine: Engine, object: number) => string | undefined;
  worldClick?: (engine: Engine, x: number, y: number) => boolean;
  finished?: (engine: Engine, object: number) => void;
  speechEnded?: (engine: Engine, object: number) => void;
  idle?: (engine: Engine) => void;
  hover?: (engine: Engine, object: number | undefined) => void;
  pickUp?: (engine: Engine, object: number) => void;
  dragMove?: (engine: Engine, object: number, x: number, y: number) => boolean;
  heldClick?: (engine: Engine, object: number, x: number, y: number) => void;
  axisLock?: (engine: Engine, object: number, dx: number) => number;
  bump?: (engine: Engine, target: number, mover: number, dx: number, dy: number) => void;
  vehicleMoved?: (engine: Engine, object: number, dx: number, dy: number) => void;
  backTarget?: (engine: Engine) => number | undefined;
  leave?: (engine: Engine) => void;
  freshScene?: (scene: Scene) => void;
  forgetOnLeave?: boolean;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function moduleFileName(moduleNumber: number): string {
  const padded = String(moduleNumber).padStart(2, "0");

  return `module${padded}.dat`;
}

function readBackRects(scene: Scene): Rect[] {
  const raw = scene.module.header.raw;
  const rects: Rect[] = [];

  for (let index = 0; index < BACK_RECT_COUNT; index += 1) {
    const base = BACK_RECT_OFFSET + index * 16;
    const left = raw.getInt32(base, true);
    const top = raw.getInt32(base + 4, true);
    const right = raw.getInt32(base + 8, true);
    const bottom = raw.getInt32(base + 12, true);

    rects.push({ left, top, right, bottom });
  }

  return rects;
}

function concatBytes(parts: Uint8Array[], totalLength: number): Uint8Array {
  const output = new Uint8Array(totalLength);
  const starts = parts.map((_, index) =>
    parts.slice(0, index).reduce((sum, part) => sum + part.length, 0),
  );

  parts.forEach((part, index) => {
    output.set(part, starts[index]);
  });

  return output;
}

function clampMotion(value: number): number {
  return Math.max(-MAX_PENDING_MOTION, Math.min(MAX_PENDING_MOTION, value));
}

function activityBackTarget(moduleNumber: number): number | undefined {
  if (!isActivityModule(moduleNumber)) {
    return undefined;
  }

  if (moduleNumber <= 3) {
    return 10;
  }

  if (moduleNumber <= 6) {
    return 11;
  }

  return 12;
}

function strictlyInside(rect: Rect, x: number, y: number): boolean {
  return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
}

export class Engine {
  readonly framebuffer: Framebuffer;
  readonly audio = new AudioEngine();
  readonly timers = new TimerScheduler();
  readonly input: Input;
  readonly progress = new Progress();
  scene: Scene | undefined;
  moduleNumber = 0;
  previousModule = 0;
  speechObject: number | undefined;
  playerName = "";
  onSceneEntered: (() => void) | undefined;
  onKey: ((key: string) => void) | undefined;
  private readonly logic = new Map<number, ModuleLogic>();
  private readonly savedScenes = new Map<number, Scene>();
  private readonly moduleStates = new Map<number, unknown>();
  private readonly pendingSnapshots = new Map<number, SceneSnapshot>();
  private readonly streamSounds = new Map<number, PlayingSound>();
  private exe: PeImage | undefined;
  private idleCounter = 0;
  private cursorX = 0;
  private cursorY = 0;
  private lastEdgeScroll = 0;
  private loading = false;
  inputLocked = false;
  private forgetOnUnload: number[] = [];
  private ambientStack: string[] = [];
  private blinkObject: number | undefined;
  private pendingDx = 0;
  private pendingDy = 0;
  private lastDrive = 0;
  private contourUp: Int16Array | undefined;
  private contourDown: Int16Array | undefined;
  reversing = false;
  private blinkCount = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.framebuffer = new Framebuffer(canvas);
    this.input = new Input(canvas, {
      move: (x, y) => this.onMove(x, y),
      click: (x, y) => this.onClick(x, y),
      relative: (dx, dy) => this.accumulateMotion(dx, dy),
      lockLost: () => undefined,
    });

    window.addEventListener("keydown", (event) => {
      if (!this.onKey || event.repeat) {
        return;
      }

      event.preventDefault();
      this.onKey(event.key);
    });
  }

  get speechBusy(): boolean {
    return this.speechObject !== undefined;
  }

  get isSettled(): boolean {
    const scene = this.scene;
    const isBusy = this.loading || this.speechBusy || this.inputBlocked || isToolbarModal();

    if (!scene || isBusy) {
      return false;
    }

    const isHolding = scene.heldObject !== undefined;
    const isAnimating = scene.objects.some((object) => object.playing && !object.looping);

    return !isHolding && !isAnimating;
  }

  private get pathActive(): boolean {
    const objects = this.scene?.objects ?? [];

    return objects.some((_, index) => this.timers.has(PATH_TIMER_BASE + index));
  }

  private get inputBlocked(): boolean {
    return this.inputLocked || this.pathActive;
  }

  register(moduleNumber: number, logic: ModuleLogic): void {
    this.logic.set(moduleNumber, logic);
  }

  async start(firstModule: number): Promise<void> {
    const exeBytes = await loadFile("tonka.exe");

    this.exe = new PeImage(exeBytes);
    this.input.registerCursor("arrow", this.exe.cursor(1));
    this.input.registerCursor("hand", this.exe.cursor(2));
    this.input.setCursor("arrow");
    await this.goto(firstModule);
    requestAnimationFrame((time) => this.frame(time));
  }

  async goto(moduleNumber: number): Promise<void> {
    if (this.loading) {
      return;
    }

    this.loading = true;
    this.input.setCursor("wait");

    if (this.scene) {
      await this.framebuffer.fadeOut();
    }

    this.unload();

    const scene = await this.loadScene(moduleNumber);

    this.previousModule = this.moduleNumber;
    this.moduleNumber = moduleNumber;
    this.scene = scene;
    this.framebuffer.setPalette(scene.module.palette);
    this.loading = false;
    this.onSceneEntered?.();
    this.enter();
  }

  logicFor(moduleNumber = this.moduleNumber): ModuleLogic {
    return this.logic.get(moduleNumber) ?? {};
  }

  requireScene(): Scene {
    if (!this.scene) {
      throw new Error("No module loaded");
    }

    return this.scene;
  }

  show(index: number): void {
    this.requireScene().setVisible(index, true);
  }

  hide(index: number): void {
    this.requireScene().setVisible(index, false);
  }

  play(index: number, group = 2, asSpeech = false, intervalMs = STREAM_INTERVAL_MS): void {
    const scene = this.requireScene();
    const object = scene.objects[index];

    this.stopStream(index, "none");
    scene.resetStream(index);
    object.visible = true;
    object.playing = true;
    object.finished = false;
    scene.showChunk(index, 0);
    this.startStreamAudio(index);
    this.timers.add(index, intervalMs, (id) => this.advanceStream(id), group);

    if (asSpeech) {
      this.beginSpeech(index);
    }
  }

  stopStream(index: number, mode: "none" | "end" | "rewind"): void {
    const scene = this.requireScene();
    const object = scene.objects[index];

    if (object.playing) {
      this.timers.remove(index);
      this.stopStreamAudio(index);
      object.playing = false;
      this.endSpeechIfCurrent(index);
    }

    if (mode === "end") {
      this.skipToEnd(index);
    }

    if (mode === "rewind") {
      object.visible = false;
      scene.resetStream(index);
    }

    this.applyStopFlags(index);
  }

  stopAllStreams(): void {
    const scene = this.requireScene();

    for (const object of scene.objects) {
      const isPlayingOneShot = object.playing && !object.looping;

      if (isPlayingOneShot) {
        this.stopStream(object.def.index, "rewind");
      }
    }
  }

  async sfx(name: string): Promise<void> {
    const sound = await this.audio.playWav(`snds/${name}.wav`);

    await sound.ended;
  }

  state<T>(init: () => T, moduleNumber = this.moduleNumber): T {
    const existing = this.moduleStates.get(moduleNumber);

    if (existing !== undefined) {
      return existing as T;
    }

    const created = init();

    this.moduleStates.set(moduleNumber, created);

    return created;
  }

  serialize(): SaveGame {
    const scenes: Record<number, SceneSnapshot> = {};
    const states: Record<number, unknown> = {};

    for (const [moduleNumber, scene] of this.savedScenes) {
      scenes[moduleNumber] = scene.snapshot();
    }

    for (const [moduleNumber, snapshot] of this.pendingSnapshots) {
      scenes[moduleNumber] ??= snapshot;
    }

    if (this.scene) {
      scenes[this.moduleNumber] = this.scene.snapshot();
    }

    for (const [moduleNumber, state] of this.moduleStates) {
      states[moduleNumber] = state;
    }

    const playerName = this.playerName;
    const progress = this.progress;

    const moduleNumber = this.moduleNumber;

    return { moduleNumber, playerName, progress, scenes, states };
  }

  restoreSave(save: SaveGame, keepModule: number): void {
    this.clearSessionState(keepModule);
    this.playerName = save.playerName;
    Object.assign(this.progress, save.progress);

    for (const [key, snapshot] of Object.entries(save.scenes)) {
      const moduleNumber = Number(key);

      if (moduleNumber !== keepModule) {
        this.pendingSnapshots.set(moduleNumber, snapshot);
      }
    }

    for (const [key, state] of Object.entries(save.states)) {
      this.moduleStates.set(Number(key), state);
    }
  }

  resetSession(keepModule: number): void {
    this.clearSessionState(keepModule);
    this.playerName = "";
    Object.assign(this.progress, new Progress());
  }

  private clearSessionState(keepModule: number): void {
    const kept = this.savedScenes.get(keepModule);

    this.savedScenes.clear();
    this.moduleStates.clear();
    this.pendingSnapshots.clear();

    if (kept) {
      this.savedScenes.set(keepModule, kept);
    }
  }

  forgetModules(moduleNumbers: number[]): void {
    this.forgetOnUnload = moduleNumbers;
  }

  resetGarage(): void {
    const progress = this.progress;

    progress.monsterBuilt = false;
    progress.dozerBuilt = false;
    progress.graderBuilt = false;
    progress.done[ACTIVITY_GARAGE] = false;
    progress.resetGarageAnimations = true;
    this.forgetModules([7, 8, 9, 71, 81, 91, 12]);
    this.goto(12).catch(() => undefined);
  }

  printScreen(): void {
    this.requireScene().render(this.framebuffer);
    this.framebuffer.present();

    const url = this.framebuffer.toDataUrl();
    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      return;
    }

    const image = printWindow.document.createElement("img");

    image.src = url;
    image.style.width = "100%";
    image.addEventListener("load", () => printWindow.print());
    printWindow.document.body.append(image);
  }

  random(limit: number): number {
    return Math.floor(Math.random() * limit);
  }

  armIdle(): void {
    const isHolding = this.scene?.heldObject !== undefined;

    this.timers.remove(IDLE_TIMER_ID);
    this.idleCounter = 0;

    if (isHolding) {
      return;
    }

    this.timers.add(IDLE_TIMER_ID, IDLE_INTERVAL_MS, () => this.idleTick(), 2);
  }

  private async loadScene(moduleNumber: number): Promise<Scene> {
    const saved = this.savedScenes.get(moduleNumber);

    if (saved) {
      return saved;
    }

    const bytes = await loadFile(moduleFileName(moduleNumber));
    const module = parseModule(moduleNumber, bytes);
    const scene = new Scene(module);
    const snapshot = this.pendingSnapshots.get(moduleNumber);

    if (!snapshot) {
      this.logicFor(moduleNumber).freshScene?.(scene);
      return scene;
    }

    scene.restore(snapshot);
    this.pendingSnapshots.delete(moduleNumber);

    return scene;
  }

  private unload(): void {
    const scene = this.scene;

    this.timers.clear();
    this.onKey = undefined;
    this.framebuffer.overlays.clear();
    this.stopAllStreamAudio();
    this.speechObject = undefined;
    this.audio.setAmbient(undefined).catch(() => undefined);

    if (!scene) {
      return;
    }

    for (const object of scene.objects) {
      this.settleStreamOnExit(object);
    }

    scene.heldObject = undefined;

    const forget = this.logicFor().forgetOnLeave ?? false;

    if (!forget) {
      this.savedScenes.set(this.moduleNumber, scene);
    }

    for (const moduleNumber of this.forgetOnUnload) {
      this.savedScenes.delete(moduleNumber);
      this.moduleStates.delete(moduleNumber);
    }

    this.forgetOnUnload = [];
  }

  private settleStreamOnExit(object: SceneObject): void {
    const scene = this.requireScene();
    const index = object.def.index;
    const replaysNextVisit = object.def.raw.getUint16(0x68, true) === 1;
    const wasPlaying = object.playing && !object.looping;
    const exitMode = object.keepLastFrame ? "end" : "rewind";

    object.playing = false;

    if (wasPlaying) {
      this.stopStream(index, exitMode);
    }

    if (replaysNextVisit) {
      object.visible = false;
      object.finished = false;
      scene.resetStream(index);
    }
  }

  private enter(): void {
    const scene = this.requireScene();

    resetToolbar();
    setHudVisible(this, true);

    this.startAmbient();
    this.startPan().catch(() => undefined);
    this.loadContours().catch(() => undefined);
    this.showParkedStreams();

    const introOverride = this.logicFor().enter?.(this);
    const introObject = introOverride ?? scene.module.header.introObject;
    const intro = scene.objects[introObject];
    const shouldPlayIntro = introObject !== 0 && intro !== undefined && !intro.finished;

    this.startPaletteCycle(shouldPlayIntro);
    this.startLoopingStreams(introObject);

    if (shouldPlayIntro) {
      this.play(introObject, 1, true);
      return;
    }

    if (!this.speechBusy) {
      this.input.setCursor("arrow");
      this.armIdle();
    }
  }

  private showParkedStreams(): void {
    const scene = this.requireScene();

    for (const object of scene.objects) {
      const isParked = object.def.streamed && object.visible && !object.looping;

      if (isParked) {
        scene.showChunk(object.def.index, object.chunkIndex);
      }
    }
  }

  private startLoopingStreams(introObject: number): void {
    const scene = this.requireScene();

    for (const object of scene.objects) {
      const index = object.def.index;
      const shouldLoop =
        object.def.streamed && object.visible && object.looping && index !== introObject;

      if (shouldLoop) {
        this.resumeLoop(index);
      }
    }
  }

  private resumeLoop(index: number): void {
    const scene = this.requireScene();
    const object = scene.objects[index];
    const baseX = object.x;
    const baseY = object.y;

    this.play(index, 2);
    scene.moveTo(index, baseX, baseY);
    scene.showChunk(index, 0);
  }

  pushAmbient(name: string): void {
    this.ambientStack.push(name);
    this.audio.setAmbient(name).catch(() => undefined);
  }

  popAmbient(): void {
    this.ambientStack.pop();

    const previous = this.ambientStack.at(-1);

    this.audio.setAmbient(previous).catch(() => undefined);
  }

  showStart(index: number): void {
    const scene = this.requireScene();

    scene.resetStream(index);
    scene.setVisible(index, true);
    scene.showChunk(index, 0);
  }

  private startAmbient(): void {
    const ambientName = `ambnt${this.moduleNumber}.wav`;

    this.ambientStack = [];
    this.startAmbientIfPresent(ambientName).catch(() => undefined);
  }

  private async startAmbientIfPresent(ambientName: string): Promise<void> {
    const exists = await hasFile(ambientName);

    if (!exists) {
      return;
    }

    this.ambientStack = [ambientName];
    await this.audio.setAmbient(ambientName);
  }

  private async startPan(): Promise<void> {
    const scene = this.requireScene();
    const hasPan = scene.module.header.hasPan !== 0;

    if (!hasPan) {
      return;
    }

    const padded = String(this.moduleNumber).padStart(2, "0");
    const bytes = await loadFile(`pan${padded}.pcx`);

    scene.pan = parsePcx(bytes);
    this.timers.add(PAN_TIMER_ID, PAN_INTERVAL_MS, () => this.advancePan(scene), 0);
  }

  private advancePan(scene: Scene): void {
    const pan = scene.pan;

    if (!pan || this.speechBusy) {
      return;
    }

    scene.panPos = (scene.panPos + 1) % pan.width;
  }

  private startPaletteCycle(introPlays: boolean): void {
    const scene = this.requireScene();
    const cycles = scene.module.header.paletteAnimation !== 0;
    const waitsForIntro = [1, 4, 5, 6].includes(this.moduleNumber) && introPlays;

    if (!cycles || waitsForIntro) {
      return;
    }

    this.setPaletteCycling(true);
  }

  setPaletteCycling(on: boolean): void {
    const isRunning = this.timers.has(PALETTE_TIMER_ID);

    if (on && !isRunning) {
      this.timers.add(PALETTE_TIMER_ID, PALETTE_INTERVAL_MS, () => this.rotatePalette(), 0);
      return;
    }

    if (!on && isRunning) {
      this.timers.remove(PALETTE_TIMER_ID);
    }
  }

  private rotatePalette(): void {
    const palette = this.requireScene().module.palette;
    const first = palette.slice(10 * 3, 11 * 3);

    palette.copyWithin(10 * 3, 11 * 3, 15 * 3);
    palette.set(first, 14 * 3);
    this.framebuffer.setPalette(palette);
  }

  private beginSpeech(index: number): void {
    setHudVisible(this, false);
    const object = this.requireScene().objects[index];
    const cursor = object.interruptible ? "none" : "wait";

    this.speechObject = index;
    this.timers.remove(IDLE_TIMER_ID);
    this.input.setCursor(cursor);
  }

  private endSpeechIfCurrent(index: number): void {
    if (this.speechObject !== index) {
      return;
    }

    this.speechObject = undefined;
    setHudVisible(this, true);

    if (this.requireScene().heldObject === undefined) {
      this.input.setCursor("arrow");
      return;
    }

    this.input.setCursor("none");
  }

  private startStreamAudio(index: number): void {
    const object = this.requireScene().objects[index];
    const chunks = object.chunks ?? [];
    const parts = chunks.map((chunk) => chunk.sound);
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);

    if (totalLength === 0) {
      return;
    }

    const pcm = concatBytes(parts, totalLength);
    const buffer = this.audio.pcmBuffer(pcm);
    const sound = this.audio.play(buffer);

    this.streamSounds.set(index, sound);
  }

  private stopStreamAudio(index: number): void {
    const sound = this.streamSounds.get(index);

    sound?.stop();
    this.streamSounds.delete(index);
  }

  private stopAllStreamAudio(): void {
    for (const sound of this.streamSounds.values()) {
      sound.stop();
    }

    this.streamSounds.clear();
  }

  private advanceStream(index: number): void {
    const scene = this.requireScene();
    const object = scene.objects[index];
    const nextChunk = object.chunkIndex + 1;
    const chunkCount = object.chunks?.length ?? 0;

    if (nextChunk < chunkCount) {
      scene.showChunk(index, nextChunk);
      return;
    }

    if (object.looping) {
      scene.showChunk(index, 0);
      this.logicFor().finished?.(this, index);
      return;
    }

    this.timers.remove(index);
    this.finishStream(index).catch(() => undefined);
  }

  private async finishStream(index: number): Promise<void> {
    const moduleNumber = this.moduleNumber;
    const sound = this.streamSounds.get(index);

    if (sound) {
      await sound.ended;
    }

    if (this.moduleNumber !== moduleNumber) {
      return;
    }

    const object = this.requireScene().objects[index];

    this.streamSounds.delete(index);
    object.playing = false;
    object.finished = true;

    if (!object.keepLastFrame) {
      object.visible = false;
      this.requireScene().resetStream(index);
    }

    this.endSpeechIfCurrent(index);
    this.logicFor().finished?.(this, index);

    if (!this.speechBusy && !this.timers.has(IDLE_TIMER_ID)) {
      this.armIdle();
    }
  }

  private skipToEnd(index: number): void {
    const scene = this.requireScene();
    const object = scene.objects[index];
    const lastChunk = (object.chunks?.length ?? 1) - 1;
    const canShowLast = object.keepLastFrame && object.def.headings !== 0 && !object.looping;

    if (!canShowLast) {
      object.visible = false;
      return;
    }

    for (let chunkIndex = 0; chunkIndex <= lastChunk; chunkIndex += 1) {
      scene.showChunk(index, chunkIndex);
    }
  }

  private applyStopFlags(index: number): void {
    const object = this.requireScene().objects[index];

    if (object.looping) {
      object.visible = true;
      object.finished = false;
      return;
    }

    object.finished = true;
  }

  private idleTick(): void {
    if (this.idleCounter < IDLE_LIMIT) {
      this.idleCounter += 1;
      return;
    }

    this.timers.remove(IDLE_TIMER_ID);
    this.idleCounter = 0;
    this.logicFor().idle?.(this);
  }

  private onMove(x: number, y: number): void {
    const scene = this.scene;

    this.cursorX = x;
    this.cursorY = y;

    if (!scene || this.speechBusy || this.loading || this.inputBlocked) {
      return;
    }

    const worldX = x + scene.scrollX;
    const held = scene.heldObject;

    if (held !== undefined) {
      this.dragNonVehicle(held, worldX, y);
      return;
    }

    const hit = scene.hitTest(worldX, y);
    const isGrabbable = hit !== undefined && scene.objects[hit].grabbable;
    const cursor = isGrabbable ? "hand" : "arrow";

    this.input.setCursor(cursor);
    this.logicFor().hover?.(this, hit);
  }

  private dragNonVehicle(held: number, worldX: number, worldY: number): void {
    if (this.requireScene().isVehicle(held)) {
      return;
    }

    this.dragHeld(held, worldX, worldY);
    this.logicFor().hover?.(this, undefined);
  }

  private dragHeld(held: number, worldX: number, worldY: number): void {
    const accepted = this.logicFor().dragMove?.(this, held, worldX, worldY) ?? true;
    const current = this.requireScene().heldObject;

    if (!accepted || current === undefined) {
      return;
    }

    this.requireScene().moveTo(current, worldX, worldY);
  }

  hold(index: number): void {
    const scene = this.requireScene();
    const worldX = this.cursorX + scene.scrollX;

    scene.heldObject = index;
    scene.setVisible(index, true);
    this.input.setRelativeOnly(true);

    if (scene.isVehicle(index)) {
      this.pendingDx = 0;
      this.pendingDy = 0;
      this.pinCursorTo(index);
      this.input.lock();
      this.input.setCursor("none");
      this.timers.remove(IDLE_TIMER_ID);
      return;
    }

    scene.moveTo(index, worldX, this.cursorY);
    this.input.setCursor("none");
    this.timers.remove(IDLE_TIMER_ID);
  }

  private pinCursorTo(index: number): void {
    const scene = this.requireScene();
    const object = scene.objects[index];
    const screenX = object.x - scene.scrollX;

    this.cursorX = screenX;
    this.cursorY = object.y;
    this.input.warp(screenX, object.y);
  }

  release(): void {
    const scene = this.requireScene();
    const held = scene.heldObject;

    scene.heldObject = undefined;
    this.input.setRelativeOnly(false);
    this.input.setCursor("arrow");

    if (held === undefined) {
      return;
    }

    const object = scene.objects[held];
    const screenX = object.x - scene.scrollX;

    this.cursorX = screenX;
    this.cursorY = object.y;
    this.input.warp(screenX, object.y);
  }

  private accumulateMotion(dx: number, dy: number): void {
    const scene = this.scene;
    const held = scene?.heldObject;

    if (!scene || held === undefined || !scene.isVehicle(held) || this.inputBlocked) {
      return;
    }

    this.pendingDx += dx;
    this.pendingDy += dy;
  }

  private driveHeld(time: number): void {
    const scene = this.scene;
    const held = scene?.heldObject;
    const isDue = time - this.lastDrive >= DRIVE_INTERVAL_MS;
    const hasMotion = this.pendingDx !== 0 || this.pendingDy !== 0;

    if (!scene || held === undefined || !isDue || !hasMotion || !scene.isVehicle(held)) {
      return;
    }

    const dx = Math.round(this.pendingDx);
    const dy = Math.round(this.pendingDy);

    this.lastDrive = time;

    const consumed = this.driveStep(held, dx, dy);

    if (consumed) {
      this.pendingDx = 0;
      this.pendingDy = 0;
      return;
    }

    this.pendingDx = clampMotion(this.pendingDx);
    this.pendingDy = clampMotion(this.pendingDy);
  }

  private driveStep(held: number, rawDx: number, rawDy: number): boolean {
    const scene = this.requireScene();
    const object = scene.objects[held];
    const width = object.image?.width ?? 0;
    const result = steer(object.heading, rawDx, rawDy, width);
    const isIdle = result.dx === 0 && result.dy === 0 && result.heading === object.heading;

    if (isIdle) {
      return false;
    }

    this.reversing = result.reversing;

    const dx = this.logicFor().axisLock?.(this, held, result.dx) ?? result.dx;
    const newX = object.x + dx;

    this.dragScroll(newX, width);

    const dy = this.clampToGround(newX, object.y, result.dy);
    const newY = object.y + dy;
    const image = scene.imageForPose(held, result.heading, object.loadSet, object.toolFrame);
    const hit = scene.collide(held, newX, newY, image, this.moduleNumber);
    const accepted = this.resolveCollision(held, hit, dx, dy);

    if (!accepted) {
      return true;
    }

    scene.moveTo(held, newX, newY);
    scene.setPose(held, result.heading, object.loadSet, object.toolFrame);
    this.pinCursorTo(held);
    this.logicFor().vehicleMoved?.(this, held, dx, dy);

    return true;
  }

  private resolveCollision(held: number, hit: number | undefined, dx: number, dy: number): boolean {
    const scene = this.requireScene();

    if (hit === undefined) {
      return true;
    }

    const isPassable = scene.objects[hit].active;
    const isOwnCargo = hit === scene.objects[held].link;

    if (!isOwnCargo) {
      this.logicFor().bump?.(this, hit, held, dx, dy);
    }

    const isPusher = scene.flag(held, 0x20) && scene.flag(hit, 0x24);

    return isPassable || isPusher;
  }

  private dragScroll(newX: number, width: number): void {
    const scene = this.requireScene();
    const margin = (width >> 1) + DRAG_SCROLL_MARGIN;

    if (this.speechBusy) {
      return;
    }

    if (newX > scene.scrollX + 640 - margin) {
      scene.scrollBy(EDGE_SCROLL_STEP);
      return;
    }

    if (newX < scene.scrollX + margin) {
      scene.scrollBy(-EDGE_SCROLL_STEP);
    }
  }

  private clampToGround(newX: number, y: number, dy: number): number {
    const up = this.contourUp;
    const down = this.contourDown;

    if (!up || !down) {
      return dy;
    }

    const column = Math.max(0, Math.min(up.length - 1, newX));
    const lowest = down[column];
    const highest = up[column];

    if (y + dy > lowest) {
      return lowest - y - 1;
    }

    if (y + dy < highest) {
      return highest - y + 1;
    }

    return dy;
  }

  async runPath(
    index: number,
    fileName: string,
    intervalMs: number,
    onDone: () => void,
  ): Promise<void> {
    const bytes = await loadFile(fileName);
    const steps = readPath(bytes);
    const moduleNumber = this.moduleNumber;
    const remaining = steps.values();

    this.timers.add(
      PATH_TIMER_BASE + index,
      intervalMs,
      () => {
        if (this.moduleNumber !== moduleNumber) {
          return;
        }

        const next = remaining.next();

        if (next.done) {
          this.timers.remove(PATH_TIMER_BASE + index);
          onDone();
          return;
        }

        this.moveChain(index, next.value.dx, next.value.dy);
      },
      2,
    );
  }

  moveChain(index: number, dx: number, dy: number): void {
    const members = this.requireScene().chain(index);

    for (const member of members) {
      this.moveOne(member, dx, dy);
    }
  }

  private moveOne(index: number, dx: number, dy: number): void {
    const scene = this.requireScene();
    const object = scene.objects[index];

    scene.moveTo(index, object.x + dx, object.y + dy);

    if (scene.isVehicle(index) && (dx !== 0 || dy !== 0)) {
      scene.setPose(index, sectorFor(dx, dy), object.loadSet, object.toolFrame);
    }
  }

  private async loadContours(): Promise<void> {
    const padded = String(this.moduleNumber).padStart(2, "0");

    this.contourUp = undefined;
    this.contourDown = undefined;

    if (this.moduleNumber > 3) {
      return;
    }

    const up = await loadFile(`contup${padded}.bin`);
    const down = await loadFile(`contdn${padded}.bin`);

    this.contourUp = readShorts(up);
    this.contourDown = readShorts(down);
  }

  cursorWorld(): [number, number] {
    const scene = this.requireScene();
    const worldX = this.cursorX + scene.scrollX;

    return [worldX, this.cursorY];
  }

  blink(index: number): void {
    this.stopBlink();
    this.blinkObject = index;
    this.blinkCount = 0;
    this.timers.add(index, BLINK_INTERVAL_MS, () => this.blinkTick(), 1);
  }

  copyPaletteEntry(target: number, source: number): void {
    const palette = this.requireScene().module.palette;
    const color = palette.slice(source * 3, source * 3 + 3);

    palette.set(color, target * 3);
    this.framebuffer.setPalette(palette);
  }

  restorePaletteEntry(index: number): void {
    const scene = this.requireScene();
    const start = index * 3;
    const color = scene.filePalette.slice(start, start + 3);

    scene.module.palette.set(color, start);
    this.framebuffer.setPalette(scene.module.palette);
  }

  private blinkTick(): void {
    const index = this.blinkObject;
    const scene = this.requireScene();

    if (index === undefined) {
      return;
    }

    const isFinished = this.blinkCount >= BLINK_TOGGLES || scene.heldObject !== undefined;

    if (isFinished) {
      this.stopBlink();
      this.armIdle();
      return;
    }

    const object = scene.objects[index];

    object.visible = !object.visible;
    this.blinkCount += 1;
  }

  private stopBlink(): void {
    const index = this.blinkObject;

    if (index === undefined) {
      return;
    }

    this.timers.remove(index);
    this.requireScene().setVisible(index, true);
    this.blinkObject = undefined;
  }

  private onClick(x: number, y: number): void {
    this.audio.resume();

    if (this.loading || !this.scene || this.inputBlocked) {
      return;
    }

    if (this.speechBusy) {
      this.skipSpeech();
      return;
    }

    const worldX = x + this.scene.scrollX;

    this.handleWorldClick(worldX, y).catch(() => undefined);
  }

  private skipSpeech(): void {
    const index = this.speechObject;

    if (index === undefined) {
      return;
    }

    const object = this.requireScene().objects[index];

    if (!object.interruptible) {
      return;
    }

    const hasImage = object.def.headings !== 0;
    const mode = hasImage ? "end" : "rewind";

    this.stopStream(index, mode);
    object.finished = true;
    const logic = this.logicFor();
    const afterSkip = logic.speechEnded ?? logic.finished;

    afterSkip?.(this, index);
    this.armIdle();
  }

  private async handleWorldClick(worldX: number, worldY: number): Promise<void> {
    const scene = this.requireScene();
    const held = scene.heldObject;

    if (this.blinkObject !== undefined) {
      this.stopBlink();
      this.armIdle();
    }

    if (isToolbarModal()) {
      await this.clickToolbarDialog(worldX, worldY);
      return;
    }

    if (held !== undefined) {
      this.clickWhileHolding(held, worldX, worldY);
      return;
    }

    const backRects = readBackRects(scene);
    const isBack = backRects.some((rect) => strictlyInside(rect, worldX, worldY));

    if (isBack) {
      await this.goBack();
      return;
    }

    const handledByModule = this.logicFor().worldClick?.(this, worldX, worldY) ?? false;

    if (handledByModule) {
      return;
    }

    const hit = scene.hitTest(worldX, worldY);

    if (hit === undefined) {
      return;
    }

    await this.clickObject(hit);
  }

  private async clickToolbarDialog(worldX: number, worldY: number): Promise<void> {
    const hit = this.requireScene().hitTest(worldX, worldY);

    if (hit === undefined) {
      return;
    }

    await handleToolbarClick(this, hit);
  }

  private clickWhileHolding(held: number, worldX: number, worldY: number): void {
    const handler = this.logicFor().heldClick;

    if (handler) {
      handler(this, held, worldX, worldY);
      return;
    }

    this.release();
  }

  private async clickObject(index: number): Promise<void> {
    const object = this.requireScene().objects[index];

    this.armIdle();

    const handledByToolbar = await handleToolbarClick(this, index);

    if (handledByToolbar) {
      return;
    }

    const canGrab = object.grabbable && !isToolbarModal();

    if (canGrab) {
      this.hold(index);
      this.logicFor().pickUp?.(this, index);
      return;
    }

    if (this.canFollowLink(object.moduleLink)) {
      await this.followLink(index, object.moduleLink);
      return;
    }

    this.logicFor().click?.(this, index);
  }

  private canFollowLink(moduleLink: number): boolean {
    const blockedByModule = this.logicFor().blocksLinks?.(this) ?? false;
    const blocked = blockedByModule || isToolbarModal();

    return moduleLink !== 0 && !blocked;
  }

  private async followLink(index: number, target: number): Promise<void> {
    const sound = linkSound(this, index) ?? this.logicFor().linkSound?.(this, index);

    if (sound) {
      await this.sfx(sound);
    }

    this.logicFor().beforeLink?.(this, index);
    this.previousModule = this.moduleNumber;
    await this.goto(target);
  }

  restartModule(moduleNumber: number): void {
    this.goto(moduleNumber).catch(() => undefined);
  }

  private async goBack(): Promise<void> {
    const scene = this.requireScene();
    const override = this.logicFor().backTarget?.(this);
    const target =
      override ??
      activityBackTarget(this.moduleNumber) ??
      scene.module.header.raw.getUint16(0x0a, true);

    await this.sfx("btnclik2");
    this.logicFor().leave?.(this);
    await this.goto(target);
  }

  private edgeScroll(time: number): void {
    const scene = this.scene;
    const isDue = time - this.lastEdgeScroll >= EDGE_SCROLL_INTERVAL_MS;

    if (!scene || !isDue || this.speechBusy || scene.heldObject !== undefined) {
      return;
    }

    this.lastEdgeScroll = time;

    if (this.cursorX > 640 - EDGE_SCROLL_MARGIN) {
      scene.scrollBy(EDGE_SCROLL_STEP);
      return;
    }

    if (this.cursorX < EDGE_SCROLL_MARGIN) {
      scene.scrollBy(-EDGE_SCROLL_STEP);
    }
  }

  private frame(time: number): void {
    this.timers.run(performance.now());
    this.driveHeld(time);
    this.edgeScroll(time);

    if (this.scene && !this.loading) {
      this.scene.render(this.framebuffer);
      this.framebuffer.present();
      this.input.drawCursor();
    }

    requestAnimationFrame((next) => this.frame(next));
  }
}
