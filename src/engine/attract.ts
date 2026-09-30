import { applyMovieFrame, MOVIE_HEIGHT, MOVIE_WIDTH, parseMovie, type Movie } from "../formats/mve";
import type { AudioEngine } from "./audio";
import { loadFile } from "./data";
import type { Framebuffer } from "./framebuffer";

const FRAME_MS = 125;
const SKIP_KEYS = new Set(["Escape", "Enter"]);

function applyPalette(framebuffer: Framebuffer, movie: Movie): void {
  for (let index = 0; index < 256; index += 1) {
    const red = movie.palette[index * 3];
    const green = movie.palette[index * 3 + 1];
    const blue = movie.palette[index * 3 + 2];

    framebuffer.setColor(index, red, green, blue);
  }
}

function queueAudio(audio: AudioEngine, block: Uint8Array): void {
  if (block.length > 0) {
    audio.queueStream(block);
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function waitForSkip(canvas: HTMLCanvasElement): { skipped: Promise<void>; dispose: () => void } {
  const controller = new AbortController();
  const skipped = new Promise<void>((resolve) => {
    canvas.addEventListener("pointerup", () => resolve(), { signal: controller.signal });
    window.addEventListener(
      "keydown",
      (event) => {
        if (SKIP_KEYS.has(event.key)) {
          resolve();
        }
      },
      { signal: controller.signal },
    );
  });
  const dispose = () => controller.abort();

  return { skipped, dispose };
}

export async function playAttractMovie(
  canvas: HTMLCanvasElement,
  framebuffer: Framebuffer,
  audio: AudioEngine,
): Promise<void> {
  const bytes = await loadFile("movie1.mve");
  const movie = parseMovie(bytes);
  const screen = new Uint8Array(MOVIE_WIDTH * MOVIE_HEIGHT);
  const skip = waitForSkip(canvas);
  const playback = { isSkipped: false };

  skip.skipped.then(() => {
    playback.isSkipped = true;
  });

  applyPalette(framebuffer, movie);
  audio.resetStream();

  for (const block of movie.preroll) {
    queueAudio(audio, block);
  }

  const start = performance.now();

  for (let index = 0; index < movie.frames.length && !playback.isSkipped; index += 1) {
    const frame = movie.frames[index];
    const due = start + index * FRAME_MS;
    const delay = Math.max(0, due - performance.now());

    const delayElapsed = sleep(delay);

    await Promise.race([delayElapsed, skip.skipped]);

    if (playback.isSkipped) {
      break;
    }

    applyMovieFrame(screen, frame);
    framebuffer.pixels.set(screen);
    framebuffer.present();
    queueAudio(audio, frame.audio);
  }

  skip.dispose();
  audio.stopAll();
  await framebuffer.fadeOut();
}
