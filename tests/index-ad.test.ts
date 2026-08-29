import { describe, expect, it } from "vitest";

import { loadIndexAds, parseIndexAdResponse } from "../lib/index-ad";

describe("首页 index_ad 广告", () => {
  it("只解析启用且字段完整的广告，并保持官方数组轮播顺序", () => {
    const ads = parseIndexAdResponse({
      format: "fsvod.index-ad.v1",
      items: [
        { id: "first", title: "第一条", image_url: "https://cdn.example.com/1.jpg", active: true, duration_seconds: 4 },
        { id: "invalid", title: "缺图片", active: true },
        { id: "hidden", title: "已关闭", image_url: "https://cdn.example.com/hidden.jpg", active: false },
        { id: "second", title: "第二条", image_url: "https://cdn.example.com/2.jpg", active: true, target: { type: "vod", vod_id: "99" } },
      ],
    });

    expect(ads.map((item) => item.id)).toEqual(["first", "second"]);
    expect(ads[0].durationSeconds).toBe(4);
    expect(ads[1].target).toEqual({ type: "vod", vodId: "99" });
  });

  it("从官方配置发现 index_ad 并在广告接口异常时返回空列表供首页兜底", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://official.example.com/api.json") {
        return new Response(JSON.stringify({ index_ad: { enabled: true, data_url: "https://ads.example.com/index_ad.php", rotation_seconds: 6 } }), { status: 200 });
      }
      if (url === "https://ads.example.com/index_ad.php") throw new Error("network down");
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      await expect(loadIndexAds(["https://official.example.com/api.json"])).resolves.toEqual({ ads: [], rotationSeconds: 6 });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("index_ad 未启用、缺失或旧字符串写法时不请求广告数据地址", async () => {
    const originalFetch = global.fetch;
    const requested: string[] = [];
    global.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      requested.push(url);
      if (url.includes("disabled")) return new Response(JSON.stringify({ index_ad: { enabled: false, data_url: "https://ads.example.com/disabled.php" } }), { status: 200 });
      if (url.includes("legacy")) return new Response(JSON.stringify({ index_ad: "https://ads.example.com/legacy.php" }), { status: 200 });
      return new Response(JSON.stringify({ sources: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      await expect(loadIndexAds(["https://official.example.com/disabled/api.json"])).resolves.toEqual({ ads: [], rotationSeconds: 5 });
      await expect(loadIndexAds(["https://official.example.com/missing/api.json"])).resolves.toEqual({ ads: [], rotationSeconds: 5 });
      await expect(loadIndexAds(["https://official.example.com/legacy/api.json"])).resolves.toEqual({ ads: [], rotationSeconds: 5 });
      expect(requested).toEqual([
        "https://official.example.com/disabled/api.json",
        "https://official.example.com/missing/api.json",
        "https://official.example.com/legacy/api.json",
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
