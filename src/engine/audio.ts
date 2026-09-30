import { loadFile } from "./data";
import { parseWav, pcm8ToFloat } from "../formats/wav";

export const STREAM_SAMPLE_RATE = 22050;

export interface PlayingSound {
  stop: () => void;
  ended: Promise<void>;
}

export class AudioEngine {
  readonly context = new AudioContext();
  private readonly output: GainNode;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private ambient: PlayingSound | undefined;
  private streamCursor = 0;
  private readonly streamSources = new Set<PlayingSound>();

  constructor() {
    this.output = this.context.createGain();
    this.output.connect(this.context.destination);
  }

  resume(): void {
    if (this.context.state === "suspended") {
      this.context.resume().catch(() => undefined);
    }
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));

    this.output.gain.value = clamped;
  }

  pcmBuffer(pcm: Uint8Array, sampleRate = STREAM_SAMPLE_RATE): AudioBuffer {
    const samples = pcm8ToFloat(pcm);
    const buffer = this.context.createBuffer(1, Math.max(1, samples.length), sampleRate);

    buffer.copyToChannel(samples, 0);

    return buffer;
  }

  loadWav(name: string): Promise<AudioBuffer> {
    const key = name.toLowerCase();
    const cached = this.buffers.get(key);

    if (cached) {
      return cached;
    }

    const pending = this.decodeWav(key);

    this.buffers.set(key, pending);

    return pending;
  }

  play(buffer: AudioBuffer, loop = false, when = 0): PlayingSound {
    const source = this.context.createBufferSource();
    const ended = new Promise<void>((resolve) => {
      source.addEventListener("ended", () => resolve());
    });

    source.buffer = buffer;
    source.loop = loop;
    source.connect(this.output);
    source.start(when);

    const stop = () => {
      source.stop();
      source.disconnect();
    };

    return { stop, ended };
  }

  async playWav(name: string): Promise<PlayingSound> {
    const buffer = await this.loadWav(name);

    return this.play(buffer);
  }

  async setAmbient(name: string | undefined): Promise<void> {
    this.ambient?.stop();
    this.ambient = undefined;

    if (!name) {
      return;
    }

    const buffer = await this.loadWav(name);

    this.ambient = this.play(buffer, true);
  }

  queueStream(pcm: Uint8Array): number {
    const buffer = this.pcmBuffer(pcm);
    const now = this.context.currentTime;
    const start = Math.max(now, this.streamCursor);

    const sound = this.play(buffer, false, start);

    this.streamSources.add(sound);
    sound.ended.then(() => this.streamSources.delete(sound)).catch(() => undefined);
    this.streamCursor = start + buffer.duration;

    return this.streamCursor;
  }

  resetStream(): void {
    this.streamCursor = 0;
  }

  stopAll(): void {
    for (const sound of this.streamSources) {
      sound.stop();
    }

    this.streamSources.clear();
    this.resetStream();
  }

  private async decodeWav(name: string): Promise<AudioBuffer> {
    const bytes = await loadFile(name);
    const wav = parseWav(bytes);
    const buffer = this.context.createBuffer(1, Math.max(1, wav.samples.length), wav.sampleRate);

    buffer.copyToChannel(wav.samples, 0);

    return buffer;
  }
}
