import { describe, expect, it } from "vitest";

import { buildCategoryTree, mergeMacCmsPages, parseMacCmsPage, parsePlaySources, sortVodItems } from "../lib/maccms";

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
      thumbnailUrl: "https://video.example.com/uploads/9.jpg",
    });
  });

  it("规范化相对海报、协议省略海报和同域 HTTP 海报地址", () => {
    const page = parseMacCmsPage({
      code: 1,
      list: [
        { vod_id: 1, vod_name: "相对海报", vod_pic: "uploads/one.jpg" },
        { vod_id: 2, vod_name: "协议省略", vod_pic: "//image.example.com/two.jpg" },
        { vod_id: 3, vod_name: "同域安全升级", vod_pic: "http://video.example.com/uploads/three.jpg" },
        { vod_id: 4, vod_name: "缩略图字段", vod_pic: "", vod_pic_thumb: "images/four.jpg" },
      ],
    }, endpoint);
    expect(page.items.map((item) => item.posterUrl)).toEqual([
      "https://video.example.com/uploads/one.jpg",
      "https://image.example.com/two.jpg",
      "https://video.example.com/uploads/three.jpg",
      "https://video.example.com/images/four.jpg",
    ]);
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

  it("主分类和子分类均按分类 ID 从小到大排序", () => {
    const categories = buildCategoryTree(
      [{
        class: [
          { type_id: 10, type_name: "分类十", type_pid: 0 },
          { type_id: 2, type_name: "分类二", type_pid: 0 },
          { type_id: 1, type_name: "分类一", type_pid: 0 },
          { type_id: 11, type_name: "子类十一", type_pid: 1 },
          { type_id: 3, type_name: "子类三", type_pid: 1 },
        ],
      }],
      [],
    );

    expect(categories.map((item) => item.id)).toEqual(["1", "2", "10"]);
    expect(categories[0].children.map((item) => item.id)).toEqual(["3", "11"]);
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

  it("合并一级分类与二级分类的分页内容并去重", () => {
    const first = parseMacCmsPage({ code: 1, page: 1, pagecount: 2, total: 2, list: [{ vod_id: 1, vod_name: "一级内容", vod_time: "2026-01-01" }, { vod_id: 2, vod_name: "共享内容", vod_time: "2026-01-02" }] }, endpoint);
    const second = parseMacCmsPage({ code: 1, page: 1, pagecount: 3, total: 2, list: [{ vod_id: 2, vod_name: "共享内容", vod_time: "2026-01-02" }, { vod_id: 3, vod_name: "子类内容", vod_time: "2026-01-03" }] }, endpoint);
    const combined = mergeMacCmsPages([first, second]);

    expect(combined.total).toBe(4);
    expect(combined.pageCount).toBe(3);
    expect(combined.items.map((item) => item.id)).toEqual(["3", "2", "1"]);
  });

  it("按热度排序并在热度相同时按更新时间回退", () => {
    const page = parseMacCmsPage({
      code: 1,
      list: [
        { vod_id: 1, vod_name: "低热度", vod_hits: 10, vod_time: "2026-01-03" },
        { vod_id: 2, vod_name: "高热度较早", vod_hits_week: 90, vod_time: "2026-01-01" },
        { vod_id: 3, vod_name: "高热度较新", vod_hits: 90, vod_time: "2026-01-04" },
      ],
    }, endpoint);

    expect(page.items.map((item) => item.hotScore)).toEqual([10, 90, 90]);
    expect(sortVodItems(page.items, "hot").map((item) => item.id)).toEqual(["3", "2", "1"]);
  });
});
