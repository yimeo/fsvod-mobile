import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
const diskEntries = new Map<string, { exists: boolean; isDirectory?: boolean; size?: number }>();
const imagePaths = new Map<string, string | null>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => storage.delete(key)); }),
  },
}));

vi.mock("expo-image", () => ({
  Image: {
    getCachePathAsync: vi.fn(async (url: string) => imagePaths.get(url) ?? null),
    clearMemoryCache: vi.fn(async () => undefined),
    clearDiskCache: vi.fn(async () => undefined),
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: vi.fn(async (path: string) => diskEntries.get(path) ?? { exists: false }),
}));

import { getPosterCacheSummary, recordPosterCache, subscribePosterCacheChanges } from "../lib/poster-cache";

describe("海报缓存统计", () => {
  beforeEach(() => {
    storage.clear();
    diskEntries.clear();
    imagePaths.clear();
  });

  it("兼容旧版索引并只累计真实存在的海报文件", async () => {
    const oldUrl = "https://poster.example.com/old.jpg";
    const currentUrl = "https://poster.example.com/current.jpg";
    storage.set("fsvod:poster-cache-urls", JSON.stringify([oldUrl]));
    storage.set("fsvod:poster-cache-index", JSON.stringify([currentUrl]));
    imagePaths.set(oldUrl, "/cache/old.jpg");
    imagePaths.set(currentUrl, "file:///cache/current.jpg");
    diskEntries.set("file:///cache/old.jpg", { exists: true, isDirectory: false, size: 1280 });
    diskEntries.set("file:///cache/current.jpg", { exists: true, isDirectory: false, size: 2560 });

    await expect(getPosterCacheSummary()).resolves.toEqual({ count: 2, bytes: 3840 });
  });

  it("图片加载完成记录旧版索引并通知设置页刷新", async () => {
    const url = "https://poster.example.com/new.jpg";
    const listener = vi.fn();
    const unsubscribe = subscribePosterCacheChanges(listener);

    recordPosterCache(url);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(JSON.parse(storage.get("fsvod:poster-cache-urls") ?? "[]")).toEqual([url]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("统计时不自动删除暂时找不到文件的海报索引", async () => {
    const url = "https://poster.example.com/temporarily-unavailable.jpg";
    storage.set("fsvod:poster-cache-urls", JSON.stringify([url]));

    await expect(getPosterCacheSummary()).resolves.toEqual({ count: 1, bytes: 0 });
    expect(JSON.parse(storage.get("fsvod:poster-cache-urls") ?? "[]")).toEqual([url]);
  });
});
