import { describe, expect, it, vi } from "vitest";

import { getSafePlaybackDuration, getSafePlaybackPosition, pauseIfLoaded } from "../lib/player-safety";

describe("播放器原生调用保护", () => {
  it("未加载媒体时不读取播放器时间或暂停播放器", () => {
    const pause = vi.fn();
    const player = {
      get currentTime(): number { throw new Error("native player has no source"); },
      get duration(): number { throw new Error("native player has no source"); },
      pause,
    };
    expect(getSafePlaybackPosition(player, false)).toBe(0);
    expect(getSafePlaybackDuration(player, false)).toBeUndefined();
    pauseIfLoaded(player, false);
    expect(pause).not.toHaveBeenCalled();
  });

  it("已加载媒体时读取进度并暂停，且吞掉原生卸载期间的异常", () => {
    const working = { currentTime: 18.6, duration: 96, pause: vi.fn() };
    expect(getSafePlaybackPosition(working, true)).toBe(18.6);
    expect(getSafePlaybackDuration(working, true)).toBe(96);
    pauseIfLoaded(working, true);
    expect(working.pause).toHaveBeenCalledOnce();

    const detaching = { currentTime: 0, duration: 0, pause: () => { throw new Error("released"); } };
    expect(() => pauseIfLoaded(detaching, true)).not.toThrow();
  });
});
