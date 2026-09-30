import type { Engine } from "../../engine/engine";

const SEMI_PATH_MS = 30;

export interface SemiRoute {
  semi: number;
  arrivePath: string;
  leavePath: string;
}

export function semiRoute(moduleNumber: number, semi: number): SemiRoute {
  const modulePadded = String(moduleNumber).padStart(2, "0");
  const semiPadded = String(semi).padStart(2, "0");
  const arrivePath = `m${modulePadded}obj${semiPadded}.bin`;
  const leavePath = `m${modulePadded}o${semiPadded}a.bin`;

  return { semi, arrivePath, leavePath };
}

export function showChain(engine: Engine, start: number): void {
  const scene = engine.requireScene();

  for (const member of scene.chain(start)) {
    scene.setVisible(member, true);
  }
}

export function bringSemi(
  engine: Engine,
  route: SemiRoute,
  chainStart: number,
  useLeavePath: boolean,
  onArrive: () => void,
): void {
  const scene = engine.requireScene();
  const pathName = useLeavePath ? route.leavePath : route.arrivePath;

  scene.objects[route.semi].link = chainStart;
  scene.objects[chainStart].carrier = route.semi;
  showChain(engine, route.semi);
  engine.audio.playWav("sfx6.wav").catch(() => undefined);
  engine.runPath(route.semi, pathName, SEMI_PATH_MS, onArrive).catch(() => undefined);
}

export function sendSemiAway(engine: Engine, route: SemiRoute, onLeave: () => void): void {
  engine.audio.playWav("sfx7.wav").catch(() => undefined);
  engine.runPath(route.semi, route.leavePath, SEMI_PATH_MS, onLeave).catch(() => undefined);
}

export function resetSemi(engine: Engine, route: SemiRoute): void {
  const scene = engine.requireScene();
  const semi = scene.objects[route.semi];

  scene.moveTo(route.semi, semi.def.x, semi.def.y);
}

export function unlinkFromChain(engine: Engine, item: number): void {
  const scene = engine.requireScene();
  const object = scene.objects[item];
  const carrier = object.carrier;
  const next = object.link;

  if (carrier >= 0) {
    scene.objects[carrier].link = next;
  }

  if (next >= 0) {
    scene.objects[next].carrier = carrier;
  }

  object.link = -1;
  object.carrier = -1;
}

export function isSemiEmpty(engine: Engine, semi: number): boolean {
  return engine.requireScene().objects[semi].link < 1;
}
