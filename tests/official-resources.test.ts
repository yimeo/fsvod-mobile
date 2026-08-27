import { describe, expect, it } from "vitest";

import { loadOfficialResourceCatalog, parseOfficialResourceConfig } from "../lib/official-resources";

describe("官方资源配置", () => {
  it("解析官方资源站名称、MACCMS 地址和更新后的配置地址", () => {
    const parsed = parseOfficialResourceConfig({
      api: "https://new-api.example.com/api.json",
      sources: [
        { name: "官方 fsvod", api: "https://fsvod.example.com/api.php/provide/vod/" },
        { title: "备用资源站", address: "https://backup.example.com/provide/vod/" },
      ],
    });

    expect(parsed.configUrls).toEqual(["https://new-api.example.com/api.json"]);
    expect(parsed.resources).toEqual([
      { key: "官方-fsvod", name: "官方 fsvod", address: "https://fsvod.example.com/api.php/provide/vod/" },
      { key: "备用资源站", name: "备用资源站", address: "https://backup.example.com/provide/vod/" },
    ]);
  });

  it("主官方配置无法读取时自动改用备用地址", async () => {
    const requested: string[] = [];
    const catalog = await loadOfficialResourceCatalog(null, async (url) => {
      requested.push(url);
      if (url.includes("api1")) throw new Error("主地址不可用");
      return { sources: [{ name: "官方 fsvod", url: "https://fsvod.example.com/api.php/provide/vod/" }] };
    });

    expect(requested).toEqual(["https://api1.066821.xyz/api.json", "https://api2.066821.xyz/api.json"]);
    expect(catalog).toMatchObject({ configUrl: "https://api2.066821.xyz/api.json", resources: [{ name: "官方 fsvod" }] });
  });

  it("检测到新官方配置地址后立即按最新地址读取资源站", async () => {
    const requested: string[] = [];
    const catalog = await loadOfficialResourceCatalog(null, async (url) => {
      requested.push(url);
      if (url.includes("api1")) return { api: "https://new-api.example.com/api.json" };
      return { sources: [{ name: "新版官方源", apiUrl: "https://new-source.example.com/api.php/provide/vod/" }] };
    });

    expect(requested).toEqual(["https://api1.066821.xyz/api.json", "https://new-api.example.com/api.json"]);
    expect(catalog).toMatchObject({ configUrl: "https://new-api.example.com/api.json", resources: [{ name: "新版官方源" }] });
  });
});
