import { playAttractMovie } from "./engine/attract";
import { hasExtractedData } from "./engine/data";
import { VolumeControl } from "./engine/volume";
import { Engine } from "./engine/engine";
import { cab } from "./modules/cab";
import { certificate } from "./modules/certificate";
import { cityMap } from "./modules/city-map";
import { demolitionLot } from "./modules/demolition";
import { garage } from "./modules/garage";
import { garageHub } from "./modules/garage-hub";
import { helpScreen } from "./modules/help";
import { mainMap } from "./modules/main-map";
import { avalanche } from "./modules/outdoor/avalanche";
import { desert } from "./modules/outdoor/desert";
import { quarry } from "./modules/outdoor/quarry";
import { castle } from "./modules/site/castle";
import { hirise } from "./modules/site/hirise";
import { park } from "./modules/site/park";
import { signIn } from "./modules/signin";
import { timeCard } from "./modules/time-card";
import { vehicleInfo } from "./modules/vehicle-info";
import { anySlotUsed, readAutosave, writeAutosave } from "./engine/save-slots";
import { runViewer } from "./viewer";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const message = document.getElementById("message") as HTMLDivElement;

function showMessage(html: string): void {
  message.innerHTML = html;
  overlay.hidden = false;
}

function showMissingData(): void {
  showMessage(
    "Game data not found.<br><br>Run <code>pnpm extract &lt;path to your CD image or game folder&gt;</code> and reload.",
  );
}

async function boot(): Promise<void> {
  const hasData = await hasExtractedData();

  if (!hasData) {
    showMissingData();
    return;
  }

  overlay.hidden = true;

  const params = new URLSearchParams(location.search);
  const isViewer = params.has("viewer");

  if (isViewer) {
    await runViewer(canvas, (text) => {
      document.title = text;
      console.log(text);
    });
    return;
  }

  const engine = new Engine(canvas);
  const startParam = params.get("module");

  registerModules(engine);

  const volume = new VolumeControl(engine.audio);

  if (import.meta.env.DEV) {
    Object.assign(window, { engine, volume });
  }

  enableAutosave(engine);

  if (startParam) {
    await engine.start(Number(startParam));
    return;
  }

  const autosave = readAutosave();
  const choice = await waitForStart(autosave !== undefined);

  engine.audio.resume();

  if (choice === "continue" && autosave) {
    const moduleNumber = autosave.moduleNumber ?? 10;

    engine.restoreSave(autosave, -1);
    await engine.start(moduleNumber);
    return;
  }

  await playAttractMovie(canvas, engine.framebuffer, engine.audio);

  const firstModule = anySlotUsed() ? 13 : 15;

  await engine.start(firstModule);
}

function saveProgress(engine: Engine): void {
  const hasPlayer = engine.playerName.length > 0;

  if (!hasPlayer || !engine.scene) {
    return;
  }

  const save = engine.serialize();

  writeAutosave(save);
}

function saveSettledProgress(engine: Engine): void {
  if (!engine.isSettled) {
    return;
  }

  saveProgress(engine);
}

function enableAutosave(engine: Engine): void {
  engine.onSceneEntered = () => saveProgress(engine);
  window.addEventListener("pagehide", () => saveSettledProgress(engine));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveSettledProgress(engine);
    }
  });
}

type StartChoice = "continue" | "new";

function startButtons(hasAutosave: boolean): string {
  const continueButton = '<button id="continue" type="button">Continue</button> ';
  const newLabel = hasAutosave ? "New game" : "Click to start";
  const newButton = `<button id="start" type="button">${newLabel}</button>`;

  return hasAutosave ? continueButton + newButton : newButton;
}

function waitForStart(hasAutosave: boolean): Promise<StartChoice> {
  showMessage(startButtons(hasAutosave));

  const newButton = document.getElementById("start") as HTMLButtonElement;
  const continueButton = document.getElementById("continue");

  return new Promise((resolve) => {
    const choose = (choice: StartChoice) => {
      overlay.hidden = true;
      canvas.requestPointerLock()?.catch(() => undefined);
      resolve(choice);
    };

    newButton.addEventListener("click", () => choose("new"), { once: true });
    continueButton?.addEventListener("click", () => choose("continue"), { once: true });
  });
}

function registerModules(engine: Engine): void {
  const singles = new Map([
    [1, quarry],
    [2, avalanche],
    [3, desert],
    [4, park],
    [5, castle],
    [6, hirise],
    [10, mainMap],
    [11, cityMap],
    [12, garageHub],
    [13, timeCard],
    [14, vehicleInfo],
    [15, signIn],
    [16, demolitionLot],
  ]);

  for (const [moduleNumber, logic] of singles) {
    engine.register(moduleNumber, logic);
  }

  for (let helpModule = 51; helpModule <= 59; helpModule += 1) {
    engine.register(helpModule, helpScreen);
  }

  for (let certificateModule = 61; certificateModule <= 68; certificateModule += 1) {
    engine.register(certificateModule, certificate);
  }

  for (const cabModule of [71, 81, 91]) {
    engine.register(cabModule, cab);
  }

  for (const garageModule of [7, 8, 9]) {
    engine.register(garageModule, garage);
  }
}

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

boot().catch((error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);

  showMessage(`Failed to start: ${text}`);
});
