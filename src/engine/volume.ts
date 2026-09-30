import type { AudioEngine } from "./audio";

const VOLUME_KEY = "construction.volume";
const MUTED_KEY = "construction.muted";
const DEFAULT_VOLUME = 80;
const KEY_STEP = 10;
const VOLUME_DOWN_KEY = "-";
const VOLUME_UP_KEY = "=";

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? Number.NaN : Number(raw);

    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export class VolumeControl {
  private readonly audio: AudioEngine;
  private readonly button: HTMLButtonElement;
  private readonly slider: HTMLInputElement;
  private volume: number;
  private muted: boolean;

  constructor(audio: AudioEngine) {
    this.audio = audio;
    this.button = document.getElementById("mute") as HTMLButtonElement;
    this.slider = document.getElementById("volume-slider") as HTMLInputElement;
    this.volume = readNumber(VOLUME_KEY, DEFAULT_VOLUME);
    this.muted = readFlag(MUTED_KEY);

    this.button.addEventListener("click", () => this.toggleMute());
    this.slider.addEventListener("input", () => this.setVolume(Number(this.slider.value)));
    window.addEventListener("keydown", (event) => this.onKey(event));
    this.apply();
  }

  private onKey(event: KeyboardEvent): void {
    const steps = new Map([
      [VOLUME_DOWN_KEY, -KEY_STEP],
      [VOLUME_UP_KEY, KEY_STEP],
    ]);
    const step = steps.get(event.key);

    if (step === undefined) {
      return;
    }

    event.preventDefault();
    this.setVolume(this.volume + step);
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    write(MUTED_KEY, String(this.muted));
    this.apply();
  }

  private setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(100, volume));

    this.volume = clamped;
    this.muted = false;
    write(VOLUME_KEY, String(clamped));
    write(MUTED_KEY, "false");
    this.apply();
  }

  private apply(): void {
    const isSilent = this.muted || this.volume === 0;
    const gain = isSilent ? 0 : this.volume / 100;
    const icon = isSilent ? "🔇" : "🔊";
    const label = this.muted ? "Unmute" : "Mute";

    this.audio.setVolume(gain);
    this.slider.value = String(this.volume);
    this.button.textContent = icon;
    this.button.setAttribute("aria-label", label);
  }
}
