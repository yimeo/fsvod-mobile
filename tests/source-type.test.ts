import { describe, expect, it } from "vitest";

import { getSourceTypeLabel } from "../lib/source-label";

describe("数据源类型标签", () => {
  it("官方源显示官方，普通源和旧数据显示普通", () => {
    expect(getSourceTypeLabel({ sourceType: "official" })).toBe("官方");
    expect(getSourceTypeLabel({ sourceType: "custom" })).toBe("普通");
    expect(getSourceTypeLabel({ sourceType: undefined })).toBe("普通");
  });
});
