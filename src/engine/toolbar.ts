import type { Engine } from "./engine";
import { ACTIVITY_GARAGE } from "./progress";

const LAST_ACTIVITY_MODULE = 9;
const FIRST_GARAGE_MODULE = 7;
const DIALOG_OVERLAY = "toolbarDialog";
const DIALOG_FONT = "bold 32px Arial, Helvetica, sans-serif";
const DIALOG_COLOR = "rgb(32,32,224)";
const RESTART_SPEECHES = new Map<number, number>([
  [1, 48],
  [2, 96],
  [3, 238],
  [4, 59],
  [5, 146],
  [6, 155],
]);

interface ToolbarObjects {
  printSpeech: number;
  panel: number;
  ok: number;
  noWay: number;
  print: number;
  restart: number;
  certificate: number;
  help: number;
  info: number;
}

interface ToolbarState {
  modal: boolean;
  isPrint: boolean;
}

const toolbar: ToolbarState = { modal: false, isPrint: false };

export function isActivityModule(moduleNumber: number): boolean {
  return moduleNumber >= 1 && moduleNumber <= LAST_ACTIVITY_MODULE;
}

function activityIndex(moduleNumber: number): number {
  if (moduleNumber >= FIRST_GARAGE_MODULE) {
    return ACTIVITY_GARAGE;
  }

  return moduleNumber - 1;
}

function objectsFor(engine: Engine): ToolbarObjects {
  const count = engine.requireScene().objects.length;

  return {
    printSpeech: count - 9,
    panel: count - 8,
    ok: count - 7,
    noWay: count - 6,
    print: count - 5,
    restart: count - 4,
    certificate: count - 3,
    help: count - 2,
    info: count - 1,
  };
}

export function isActivityDone(engine: Engine): boolean {
  const index = activityIndex(engine.moduleNumber);

  return engine.progress.done[index];
}

export function setHudVisible(engine: Engine, visible: boolean): void {
  if (!isActivityModule(engine.moduleNumber)) {
    return;
  }

  const scene = engine.requireScene();
  const objects = objectsFor(engine);
  const shown = isActivityDone(engine)
    ? [objects.print, objects.restart, objects.certificate]
    : [objects.help, objects.info];

  for (const index of shown) {
    scene.setVisible(index, visible);
  }
}

export function isToolbarModal(): boolean {
  return toolbar.modal;
}

function openDialog(engine: Engine, isPrint: boolean): void {
  const objects = objectsFor(engine);
  const text = isPrint ? "Print Now?" : "Restart Now?";
  const x = isPrint ? 260 : 256;
  const speech = isPrint
    ? objects.printSpeech
    : (RESTART_SPEECHES.get(engine.moduleNumber) ?? objects.printSpeech);

  toolbar.modal = true;
  toolbar.isPrint = isPrint;
  engine.show(objects.panel);
  engine.show(objects.ok);
  engine.show(objects.noWay);
  engine.framebuffer.overlays.set(DIALOG_OVERLAY, {
    text,
    x,
    y: 160,
    font: DIALOG_FONT,
    color: DIALOG_COLOR,
  });
  engine.play(speech, 2, true);
}

function closeDialog(engine: Engine): void {
  const objects = objectsFor(engine);

  toolbar.modal = false;
  engine.hide(objects.panel);
  engine.hide(objects.ok);
  engine.hide(objects.noWay);
  engine.framebuffer.overlays.delete(DIALOG_OVERLAY);
}

function printActivity(engine: Engine): void {
  const objects = objectsFor(engine);
  const toolbarObjects = [objects.print, objects.restart, objects.certificate];

  for (const index of toolbarObjects) {
    engine.hide(index);
  }

  engine.printScreen();
  setHudVisible(engine, true);
}

function restartActivity(engine: Engine): void {
  const moduleNumber = engine.moduleNumber;
  const certificateModule = 60 + moduleNumber;

  engine.forgetModules([moduleNumber, certificateModule]);
  engine.restartModule(moduleNumber);
}

async function confirm(engine: Engine): Promise<void> {
  await engine.sfx("btnclik1");
  closeDialog(engine);

  if (toolbar.isPrint) {
    printActivity(engine);
    return;
  }

  restartActivity(engine);
}

export async function handleToolbarClick(engine: Engine, object: number): Promise<boolean> {
  if (!isActivityModule(engine.moduleNumber)) {
    return false;
  }

  const objects = objectsFor(engine);

  if (toolbar.modal) {
    await handleDialogClick(engine, objects, object);
    return true;
  }

  if (object === objects.print || object === objects.restart) {
    await engine.sfx("btnclik1");
    openDialog(engine, object === objects.print);
    return true;
  }

  return false;
}

async function handleDialogClick(
  engine: Engine,
  objects: ToolbarObjects,
  object: number,
): Promise<void> {
  if (object === objects.ok) {
    await confirm(engine);
    return;
  }

  if (object === objects.noWay) {
    await engine.sfx("btnclik1");
    closeDialog(engine);
  }
}

export function resetToolbar(): void {
  toolbar.modal = false;
}

export function linkSound(engine: Engine, object: number): string | undefined {
  if (!isActivityModule(engine.moduleNumber)) {
    return undefined;
  }

  const objects = objectsFor(engine);

  if (object === objects.help) {
    return "cellphon";
  }

  if (object === objects.info) {
    return "pageturn";
  }

  return undefined;
}
