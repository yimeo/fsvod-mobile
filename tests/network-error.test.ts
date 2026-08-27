import { toChineseNetworkError } from "../lib/network-error";
import { describe, expect, it } from "vitest";

describe("网络错误中文化", () => {
  it("将请求取消或中断提示转换为中文", () => {
    expect(toChineseNetworkError(new Error("signal is aborted without reason"))).toBe("请求已取消或超时，请稍后重试");
  });

  it("将常见网络和 HTTP 错误转换为中文", () => {
    expect(toChineseNetworkError(new Error("Failed to fetch"))).toBe("无法连接服务器，请检查网络或数据源地址");
    expect(toChineseNetworkError(new Error("HTTP 404"))).toBe("接口地址不存在或已变更（HTTP 404）");
    expect(toChineseNetworkError(new Error("HTTP 503"))).toBe("服务器暂时不可用（HTTP 503）");
  });

  it("保留已有中文提示并隐藏未知英文异常", () => {
    expect(toChineseNetworkError(new Error("数据源未返回可用影视数据"))).toBe("数据源未返回可用影视数据");
    expect(toChineseNetworkError(new Error("Unexpected socket condition"), "数据源连接失败，请稍后重试")).toBe("数据源连接失败，请稍后重试");
  });
});
