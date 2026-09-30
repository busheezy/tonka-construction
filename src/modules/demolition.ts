import type { Engine, ModuleLogic } from "../engine/engine";
import { EMPTY_LOT } from "../engine/progress";

const PARCHMENT = 0;
const FLIPPER = 1;
const FIRST_BLUEPRINT = 2;
const BLUEPRINT_COUNT = 3;
const FIRST_DESCRIPTION = 18;
const CLICK_WORKER_PROMPT = 21;
const AFTER_BLAST = 22;
const RUSTY_BLUEPRINTS = 23;
const FIRST_RUBBLE = 30;
const LAST_RUBBLE = 57;
const BULLDOZER = 58;
const FIRST_PROJECT = 4;

interface LotSetup {
  lotIndex: number;
  worker: number;
  blasts: number[];
}

const LOTS = new Map<number, LotSetup>([
  [3, { lotIndex: 0, worker: 29, blasts: [33] }],
  [7, { lotIndex: 1, worker: 27, blasts: [14, 15, 16, 17] }],
  [11, { lotIndex: 2, worker: 25, blasts: [5, 6, 7, 8, 9, 10, 11, 12, 13] }],
]);

const LAST_BLASTS = [13, 17, 33];
const WORKERS = [25, 27, 29];

interface DemolitionState {
  blueprint: number;
}

const demolition: DemolitionState = { blueprint: 0 };

function currentLot(engine: Engine): LotSetup {
  const lot = LOTS.get(engine.progress.cityLot);

  if (!lot) {
    return LOTS.get(3) as LotSetup;
  }

  return lot;
}

function isBlueprintUsed(engine: Engine, blueprintIndex: number): boolean {
  const project = FIRST_PROJECT + blueprintIndex;
  const lot = currentLot(engine);

  return engine.progress.lotProject.some(
    (value, lotIndex) => value === project && lotIndex !== lot.lotIndex,
  );
}

function markUsedBlueprints(engine: Engine): void {
  const scene = engine.requireScene();

  for (let index = 0; index < BLUEPRINT_COUNT; index += 1) {
    if (!isBlueprintUsed(engine, index)) {
      continue;
    }

    const blueprint = scene.objects[FIRST_BLUEPRINT + index];

    scene.setFrame(FIRST_BLUEPRINT + index, 1);
    blueprint.moduleLink = 0;
  }
}

function enter(engine: Engine): number {
  const scene = engine.requireScene();
  const lot = currentLot(engine);

  demolition.blueprint = 0;
  engine.stopStream(FLIPPER, "rewind");
  engine.progress.lotProject[lot.lotIndex] = FIRST_PROJECT;
  markUsedBlueprints(engine);

  for (const index of [PARCHMENT, FLIPPER, 2, 3, 4, BULLDOZER]) {
    scene.setVisible(index, false);
  }

  for (const blast of lot.blasts) {
    engine.showStart(blast);
  }

  scene.objects[lot.worker].finished = false;

  return lot.worker;
}

function flipBlueprint(engine: Engine): void {
  const scene = engine.requireScene();
  const lot = currentLot(engine);

  engine.hide(FIRST_BLUEPRINT + demolition.blueprint);
  demolition.blueprint = (demolition.blueprint + 1) % BLUEPRINT_COUNT;
  engine.show(FIRST_BLUEPRINT + demolition.blueprint);
  engine.progress.lotProject[lot.lotIndex] = FIRST_PROJECT + demolition.blueprint;
  engine.show(FLIPPER);
  scene.setFrame(FLIPPER, (scene.objects[FLIPPER].frame + 1) % BLUEPRINT_COUNT);
  engine.stopAllStreams();
  engine.play(FIRST_DESCRIPTION + demolition.blueprint, 2, true);
}

async function clickAsync(engine: Engine, object: number): Promise<void> {
  if (object === FLIPPER) {
    await engine.sfx("pageturn");
    flipBlueprint(engine);
    return;
  }

  const workerIndex = WORKERS.indexOf(object);

  if (workerIndex === -1) {
    return;
  }

  const lot = currentLot(engine);

  engine.hide(object);
  engine.play(lot.blasts[0], 2, true);
}

function showBlueprints(engine: Engine): void {
  engine.show(PARCHMENT);
  engine.show(FLIPPER);
  engine.show(FIRST_BLUEPRINT);
  engine.play(FIRST_DESCRIPTION, 2, true);
}

function finished(engine: Engine, object: number): void {
  const lot = currentLot(engine);
  const blastIndex = lot.blasts.indexOf(object);
  const isChainedBlast = blastIndex !== -1 && !LAST_BLASTS.includes(object);

  if (isChainedBlast) {
    engine.play(lot.blasts[blastIndex + 1], 2, true);
    return;
  }

  if (LAST_BLASTS.includes(object)) {
    for (let index = FIRST_RUBBLE; index <= LAST_RUBBLE; index += 1) {
      engine.hide(index);
    }

    engine.play(AFTER_BLAST, 2, true);
    return;
  }

  const followUps = new Map<number, () => void>([
    [AFTER_BLAST, () => engine.play(RUSTY_BLUEPRINTS, 2, true)],
    [RUSTY_BLUEPRINTS, () => showBlueprints(engine)],
    [25, () => engine.play(CLICK_WORKER_PROMPT, 2, true)],
    [27, () => engine.play(CLICK_WORKER_PROMPT, 2, true)],
  ]);

  followUps.get(object)?.();
}

function beforeLink(engine: Engine): void {
  const lot = currentLot(engine);
  const project = engine.progress.lotProject[lot.lotIndex];

  if (project === EMPTY_LOT) {
    engine.progress.lotProject[lot.lotIndex] = FIRST_PROJECT;
  }
}

export const demolitionLot: ModuleLogic = {
  enter,
  click: (engine, object) => {
    clickAsync(engine, object).catch(() => undefined);
  },
  finished,
  speechEnded: finished,
  beforeLink,
  backTarget: () => 11,
};
