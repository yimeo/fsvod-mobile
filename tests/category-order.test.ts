import { describe, expect, it } from "vitest";

import { promoteCategoryId, sortCategoriesByOrder } from "../lib/category-order";

describe("常用分类排序", () => {
  const categories = [
    { id: "1", name: "电影", parentId: null, children: [] },
    { id: "2", name: "剧集", parentId: null, children: [] },
    { id: "3", name: "综艺", parentId: null, children: [] },
  ];

  it("将用户访问或置顶的分类移动到最前并去重", () => {
    expect(promoteCategoryId(["2", "1"], "3")).toEqual(["3", "2", "1"]);
    expect(promoteCategoryId(["2", "1"], "2")).toEqual(["2", "1"]);
  });

  it("根据持久化顺序重排分类，其余分类按中文名称自然升序", () => {
    expect(sortCategoriesByOrder(categories, ["3"]).map((item) => item.id)).toEqual(["3", "1", "2"]);
  });

  it("无常用分类时，以中文名称稳定升序显示一级分类", () => {
    const unsorted = [
      { id: "4", name: "综艺", parentId: null, children: [] },
      { id: "3", name: "连续剧", parentId: null, children: [] },
      { id: "2", name: "动漫", parentId: null, children: [] },
      { id: "1", name: "电影", parentId: null, children: [] },
    ];
    expect(sortCategoriesByOrder(unsorted, []).map((item) => item.name)).toEqual(["电影", "动漫", "连续剧", "综艺"]);
  });
});
