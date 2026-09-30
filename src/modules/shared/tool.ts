import { sectorFor, turnDifference } from "../../engine/driving";
import type { Engine } from "../../engine/engine";

const TOOL_FRAME_MS = 55;
const TOOL_TIMER_ID = 3000;

export function animateTool(
  engine: Engine,
  vehicle: number,
  lowering: boolean,
  onStep: () => void,
  onDone: () => void,
): void {
  const scene = engine.requireScene();
  const object = scene.objects[vehicle];
  const frames = Math.max(1, object.def.framesPerSet);
  const sequence = Array.from({ length: frames }, (_, index) =>
    lowering ? index : frames - 1 - index,
  );
  const remaining = sequence.values();

  engine.inputLocked = true;
  engine.timers.add(
    TOOL_TIMER_ID,
    TOOL_FRAME_MS,
    () => {
      const next = remaining.next();

      if (next.done) {
        engine.timers.remove(TOOL_TIMER_ID);
        engine.inputLocked = false;
        onDone();
        return;
      }

      scene.setPose(vehicle, object.heading, object.loadSet, next.value);
      onStep();
    },
    2,
  );
}

export function facesTarget(engine: Engine, vehicle: number, target: number): boolean {
  const scene = engine.requireScene();
  const mover = scene.objects[vehicle];
  const other = scene.objects[target];
  const direction = sectorFor(other.x - mover.x, other.y - mover.y);
  const difference = Math.abs(turnDifference(mover.heading, direction));

  return difference <= 1;
}

export function applyLoadPose(engine: Engine, vehicle: number): void {
  const scene = engine.requireScene();
  const object = scene.objects[vehicle];
  const hasLoadPoses = object.def.sets > 1;
  const loadSet = hasLoadPoses ? object.loadState : 0;

  scene.setPose(vehicle, object.heading, loadSet, object.toolFrame);
}

export function targetOf(engine: Engine, index: number): [number, number] {
  const raw = engine.requireScene().objects[index].def.raw;
  const targetX = raw.getInt16(0x7c, true);
  const targetY = raw.getInt16(0x7e, true);

  return [targetX, targetY];
}

export function isNearTarget(engine: Engine, index: number): boolean {
  const object = engine.requireScene().objects[index];
  const [targetX, targetY] = targetOf(engine, index);
  const width = object.image?.width ?? 0;
  const height = object.image?.height ?? 0;

  return Math.abs(object.x - targetX) < width && Math.abs(object.y - targetY) < height;
}
