import { loadFile } from "./engine/data";
import { Framebuffer, SCREEN_WIDTH } from "./engine/framebuffer";
import {
  decodeChunkImage,
  decodeFrame,
  parseModule,
  readStreamChunks,
  type GameModule,
} from "./formats/module";

const MODULE_NUMBERS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 51, 52, 53, 54, 55, 56, 57, 58, 59, 61, 62,
  63, 64, 65, 66, 67, 68, 71, 81, 91,
];

interface ViewerState {
  moduleIndex: number;
  objectIndex: number;
  frame: number;
  scrollX: number;
}

function moduleFileName(moduleNumber: number): string {
  const padded = String(moduleNumber).padStart(2, "0");

  return `module${padded}.dat`;
}

function drawObject(framebuffer: Framebuffer, module: GameModule, state: ViewerState): string {
  const object = module.objects[state.objectIndex];

  if (!object) {
    return "no objects";
  }

  if (object.streamed) {
    const chunks = readStreamChunks(module, object);
    const chunk = chunks[state.frame % chunks.length];
    const image = decodeChunkImage(chunk);
    const summary = `stream chunk ${state.frame % chunks.length}/${chunks.length} ${chunk.width}x${chunk.height} dx${chunk.offsetX} dy${chunk.offsetY} snd${chunk.sound.length}`;

    if (image) {
      const left = object.x + chunk.offsetX - state.scrollX;
      const top = object.y + chunk.offsetY;

      framebuffer.drawTransparent(image, left, top);
    }

    return summary;
  }

  const frame = state.frame % Math.max(1, object.frameCount);
  const image = decodeFrame(module, object, frame);
  const left = object.x - Math.floor(image.width / 2) - state.scrollX;
  const top = object.y - Math.floor(image.height / 2);

  framebuffer.drawTransparent(image, left, top);

  return `frame ${frame}/${object.frameCount} ${image.width}x${image.height} at ${object.x},${object.y} type ${object.type}`;
}

export async function runViewer(
  canvas: HTMLCanvasElement,
  status: (text: string) => void,
): Promise<void> {
  const framebuffer = new Framebuffer(canvas);
  const state: ViewerState = { moduleIndex: 0, objectIndex: 0, frame: 0, scrollX: 0 };
  const modules = new Map<number, GameModule>();

  async function currentModule(): Promise<GameModule> {
    const moduleNumber = MODULE_NUMBERS[state.moduleIndex];
    const cached = modules.get(moduleNumber);

    if (cached) {
      return cached;
    }

    const bytes = await loadFile(moduleFileName(moduleNumber));
    const parsed = parseModule(moduleNumber, bytes);

    modules.set(moduleNumber, parsed);

    return parsed;
  }

  async function render(): Promise<void> {
    const module = await currentModule();
    const maxScroll = module.background.width - SCREEN_WIDTH;

    state.scrollX = Math.max(0, Math.min(maxScroll, state.scrollX));
    framebuffer.setPalette(module.palette);
    framebuffer.drawOpaque(module.background, state.scrollX, 0);

    const summary = drawObject(framebuffer, module, state);

    framebuffer.present();
    status(
      `module ${module.number} (${module.header.label}) object ${state.objectIndex}/${module.objects.length} ${summary}`,
    );
  }

  const keyActions: Record<string, () => void> = {
    PageDown: () => {
      state.moduleIndex = (state.moduleIndex + 1) % MODULE_NUMBERS.length;
      state.objectIndex = 0;
      state.frame = 0;
    },
    PageUp: () => {
      state.moduleIndex = (state.moduleIndex + MODULE_NUMBERS.length - 1) % MODULE_NUMBERS.length;
      state.objectIndex = 0;
      state.frame = 0;
    },
    ArrowDown: () => {
      state.objectIndex += 1;
      state.frame = 0;
    },
    ArrowUp: () => {
      state.objectIndex = Math.max(0, state.objectIndex - 1);
      state.frame = 0;
    },
    ArrowRight: () => {
      state.frame += 1;
    },
    ArrowLeft: () => {
      state.frame = Math.max(0, state.frame - 1);
    },
    a: () => {
      state.scrollX -= 64;
    },
    d: () => {
      state.scrollX += 64;
    },
  };

  window.addEventListener("keydown", (event) => {
    const action = keyActions[event.key];

    if (!action) {
      return;
    }

    event.preventDefault();
    action();
    render().catch((error: unknown) => {
      status(String(error));
    });
  });

  await render();
}
