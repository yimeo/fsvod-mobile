import { describe, expect, it } from "vitest";

import { buildCategoryTree, parseMacCmsPage, parsePlaySources } from "../lib/maccms";

describe("MACCMS 数据适配", () => {
  const endpoint = "https://video.example.com/api.php/provide/vod/";

  it("将标准列表数据转为影视列表", () => {
    const page = parseMacCmsPage(
      {
        code: 1,
        page: 2,
        pagecount: 4,
        total: 66,
        list: [
          {
            vod_id: 9,
            vod_name: "飞鸿测试片",
            type_id: 3,
            type_id_1: 1,
            type_name: "动作",
            vod_pic: "/uploads/9.jpg",
            vod_remarks: "更新至 10 集",
          },
        ],
      },
      endpoint,
    );

    expect(page.page).toBe(2);
    expect(page.items[0]).toMatchObject({
      id: "9",
      name: "飞鸿测试片",
      parentTypeId: "1",
      posterUrl: "https://video.example.com/uploads/9.jpg",
    });
  });

  it("将父子分类组织为树形结构", () => {
    const categories = buildCategoryTree(
      [
        {
          class: [
            { type_id: 1, type_name: "电影", type_pid: 0 },
            { type_id: 3, type_name: "动作", type_pid: 1 },
          ],
        },
      ],
      [],
    );

    expect(categories).toHaveLength(1);
    expect(categories[0].children[0]).toMatchObject({ id: "3", name: "动作" });
  });

  it("解析多线路与多剧集播放地址", () => {
    const sources = parsePlaySources(
      "主线路$$$备用线路",
      "第 1 集$https://cdn.example.com/1.m3u8#第 2 集$https://cdn.example.com/2.m3u8$$$正片$https://cdn.example.com/movie.mp4",
    );

    expect(sources).toHaveLength(2);
    expect(sources[0].episodes).toHaveLength(2);
    expect(sources[1].episodes[0].url).toBe("https://cdn.example.com/movie.mp4");
  });
});
