import type { Engine, ModuleLogic } from "../engine/engine";

const CARD = 0;
const INTRO = 1;
const THANKS = 2;
const TYPE_PROMPT = 3;
const OK_BUTTON = 4;
const MAX_NAME_LENGTH = 11;
const DEFAULT_NAME = "Jr. Trucker";
const NAME_OVERLAY = "name";
const NAME_X = 140;
const NAME_Y = 67;
const NAME_FONT = "bold 24px Arial, Helvetica, sans-serif";
const ALLOWED_CHARACTER = /^[A-Z0-9 ]$/;

interface SignInState {
  typing: boolean;
  name: string;
}

const state: SignInState = { typing: false, name: "" };

function drawName(engine: Engine): void {
  const caret = state.typing ? "_" : "";
  const text = state.name + caret;

  engine.framebuffer.overlays.set(NAME_OVERLAY, {
    text,
    x: NAME_X,
    y: NAME_Y,
    font: NAME_FONT,
    color: "#000",
  });
}

function submitName(engine: Engine): void {
  if (state.name.length === 0) {
    return;
  }

  engine.stopStream(TYPE_PROMPT, "rewind");
  state.typing = false;
  engine.framebuffer.overlays.delete(NAME_OVERLAY);
  engine.playerName = state.name;
  engine.hide(INTRO);
  engine.hide(CARD);
  engine.hide(OK_BUTTON);
  engine.play(THANKS, 2, true);
}

function typeKey(engine: Engine, key: string): void {
  if (key === "Enter") {
    submitName(engine);
    return;
  }

  if (key === "Backspace") {
    state.name = state.name.slice(0, -1);
    drawName(engine);
    return;
  }

  const character = key.toUpperCase();
  const isAllowed = ALLOWED_CHARACTER.test(character);
  const hasRoom = state.name.length < MAX_NAME_LENGTH;

  if (!isAllowed || !hasRoom) {
    return;
  }

  state.name += character;
  drawName(engine);
}

async function pressOk(engine: Engine): Promise<void> {
  await engine.sfx("btnclik1");

  if (state.name.length === 0) {
    state.name = DEFAULT_NAME;
  }

  submitName(engine);
}

export const signIn: ModuleLogic = {
  enter: (engine) => {
    state.name = "";
    state.typing = false;
    engine.onKey = (key) => {
      if (state.typing) {
        typeKey(engine, key);
      }
    };
  },
  finished: (engine, object) => {
    if (object === INTRO) {
      engine.show(CARD);
      engine.show(OK_BUTTON);
      engine.play(TYPE_PROMPT, 2, true);
      state.typing = true;
      drawName(engine);
      return;
    }

    if (object === THANKS) {
      engine.onKey = undefined;
      engine.goto(10).catch(() => undefined);
    }
  },
  click: (engine, object) => {
    if (object === OK_BUTTON && state.typing) {
      pressOk(engine).catch(() => undefined);
    }
  },
};
