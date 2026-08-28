export interface PlayerSafetyTarget {
  currentTime: number;
  duration: number;
  pause: () => void;
}

/** Avoids touching a native player that has not attached a media source or is already detaching. */
export function getSafePlaybackPosition(player: PlayerSafetyTarget, hasLoadedSource: boolean): number {
  if (!hasLoadedSource) return 0;
  try {
    const value = player.currentTime;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function getSafePlaybackDuration(player: PlayerSafetyTarget, hasLoadedSource: boolean): number | undefined {
  if (!hasLoadedSource) return undefined;
  try {
    return Number.isFinite(player.duration) ? player.duration : undefined;
  } catch {
    return undefined;
  }
}

export function pauseIfLoaded(player: PlayerSafetyTarget, hasLoadedSource: boolean): void {
  if (!hasLoadedSource) return;
  try {
    player.pause();
  } catch {
    // Native player release can race with a route transition on Android.
  }
}
