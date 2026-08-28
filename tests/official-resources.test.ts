import { describe, expect, it, vi } from "vitest";

import { loadOfficialResourceCatalog, parseOfficialResourceConfig } from "../lib/official-resources";

describe("官方资源配置", () => {
  it("解析官方资源站名称、MACCMS 地址和更新后的配置地址", () => {
    const parsed = parseOfficialResourceConfig({
      primaryApi: "https://new-api.example.com/api.json",
      backupApi: "https://new-backup.example.com/api.json",
      sources: [
        { name: "官方 fsvod", api: "https://fsvod.example.com/api.php/provide/vod/" },
        { title: "备用资源站", address: "https://backup.example.com/provide/vod/" },
      ],
    });

    expect(parsed).toMatchObject({ primaryApi: "https://new-api.example.com/api.json", backupApi: "https://new-backup.example.com/api.json" });
    expect(parsed.configUrls).toEqual(["https://new-api.example.com/api.json", "https://new-backup.example.com/api.json"]);
    expect(parsed.resources).toEqual([
      { key: "官方-fsvod", name: "官方 fsvod", address: "https://fsvod.example.com/api.php/provide/vod/" },
      { key: "备用资源站", name: "备用资源站", address: "https://backup.example.com/provide/vod/" },
    ]);
  });

  it("主官方配置无法读取时自动改用备用地址", async () => {
    const requested: string[] = [];
    const catalog = await loadOfficialResourceCatalog(undefined, async (url) => {
      requested.push(url);
      if (url.includes("api.075700.xyz")) throw new Error("主地址不可用");
      return { sources: [{ name: "官方 fsvod", url: "https://fsvod.example.com/api.php/provide/vod/" }] };
    });

    expect(requested).toEqual(["https://api.075700.xyz/api.json", "http://api.07571800.xyz/api.json"]);
    expect(catalog).toMatchObject({ configUrl: "http://api.07571800.xyz/api.json", resources: [{ name: "官方 fsvod" }] });
  });

  it("每次默认请求都强制绕过 api.json 缓存", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    try {
      await loadOfficialResourceCatalog(["https://api.075700.xyz/api.json"]);
      await loadOfficialResourceCatalog(["https://api.075700.xyz/api.json"]);
      const firstCall = fetchSpy.mock.calls[0];
      const secondCall = fetchSpy.mock.calls[1];
      const firstUrl = String(firstCall?.[0]);
      const secondUrl = String(secondCall?.[0]);
      expect(firstUrl).toContain("__fsvod_nocache=");
      expect(secondUrl).toContain("__fsvod_nocache=");
      expect(firstUrl).not.toBe(secondUrl);
      expect(firstCall?.[1]).toMatchObject({ cache: "no-store", headers: expect.objectContaining({ "Cache-Control": "no-cache, no-store, max-age=0", Pragma: "no-cache" }) });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("备用配置下发新主备地址后整体替换旧地址组", async () => {
    const requested: string[] = [];
    const catalog = await loadOfficialResourceCatalog(undefined, async (url) => {
      requested.push(url);
      if (url.includes("api.075700.xyz")) throw new Error("主地址不可用");
      if (url.includes("07571800")) return { primaryApi: "https://new-api.example.com/api.json", backupApi: "https://new-backup.example.com/api.json" };
      return { sources: [{ name: "新版官方源", apiUrl: "https://new-source.example.com/api.php/provide/vod/" }] };
    });

    expect(requested).toEqual(["https://api.075700.xyz/api.json", "http://api.07571800.xyz/api.json", "https://new-api.example.com/api.json"]);
    expect(catalog).toMatchObject({ configUrl: "https://new-api.example.com/api.json", configEndpoints: ["https://new-api.example.com/api.json", "https://new-backup.example.com/api.json"], resources: [{ name: "新版官方源" }] });
  });
});
