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

  it("根据持久化顺序重排分类，其余分类保持原有相对顺序", () => {
    expect(sortCategoriesByOrder(categories, ["3", "1"]).map((item) => item.id)).toEqual(["3", "1", "2"]);
  });
});
