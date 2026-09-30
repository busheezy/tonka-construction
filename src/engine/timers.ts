export type TimerCallback = (id: number) => void;

interface TimerEntry {
  id: number;
  intervalMs: number;
  group: number;
  lastFired: number;
  callback: TimerCallback;
}

const GROUP_ORDER = [0, 1, 2];

export class TimerScheduler {
  private entries: TimerEntry[] = [];

  add(id: number, intervalMs: number, callback: TimerCallback, group: number): void {
    const entry = { id, intervalMs, group, lastFired: 0, callback };

    this.entries.push(entry);
  }

  remove(id: number): void {
    const index = this.entries.findIndex((entry) => entry.id === id);

    if (index === -1) {
      return;
    }

    this.entries.splice(index, 1);
  }

  has(id: number): boolean {
    return this.entries.some((entry) => entry.id === id);
  }

  clear(): void {
    this.entries = [];
  }

  run(now: number): void {
    for (const group of GROUP_ORDER) {
      this.runGroup(group, now);
    }
  }

  private runGroup(group: number, now: number): void {
    const snapshot = this.entries.filter((entry) => entry.group === group);

    for (const entry of snapshot) {
      const isStillActive = this.entries.includes(entry);
      const isDue = now - entry.lastFired >= entry.intervalMs;

      if (!isStillActive || !isDue) {
        continue;
      }

      entry.lastFired = now;
      entry.callback(entry.id);
    }
  }
}
