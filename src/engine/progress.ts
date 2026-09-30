export const ACTIVITY_QUARRY = 0;
export const ACTIVITY_AVALANCHE = 1;
export const ACTIVITY_DESERT = 2;
export const ACTIVITY_PARK = 3;
export const ACTIVITY_CASTLE = 4;
export const ACTIVITY_HIRISE = 5;
export const ACTIVITY_GARAGE = 6;
const ACTIVITY_COUNT = 7;
export const EMPTY_LOT = 0x10;

export class Progress {
  done: boolean[] = Array.from({ length: ACTIVITY_COUNT }, () => false);
  timesCompleted: number[] = Array.from({ length: ACTIVITY_COUNT + 1 }, () => 0);
  masterBuilder = false;
  monsterBuilt = false;
  dozerBuilt = false;
  graderBuilt = false;
  lotProject: number[] = [EMPTY_LOT, EMPTY_LOT, EMPTY_LOT];
  cityLot = 0;
  mapGuideObject = 9;
  resetGarageAnimations = false;
  certificatesSeen: number[] = [];

  complete(activity: number): void {
    this.done[activity] = true;
    this.timesCompleted[activity] += 1;

    const allDone = this.done.every((isDone) => isDone);

    if (allDone) {
      this.masterBuilder = true;
    }
  }
}
