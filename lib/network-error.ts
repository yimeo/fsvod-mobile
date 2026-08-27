function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  return typeof error === "string" ? error.trim() : "";
}

/** 将底层网络异常转换为适合在应用界面展示的中文说明。 */
export function toChineseNetworkError(error: unknown, fallback = "网络请求失败，请稍后重试"): string {
  const message = messageFrom(error);
  if (!message) return fallback;
  if (/\p{Script=Han}/u.test(message)) return message;

  const normalized = message.toLowerCase();
  if (normalized.includes("abort") || normalized.includes("cancel")) return "请求已取消或超时，请稍后重试";
  if (normalized.includes("timed out") || normalized.includes("timeout")) return "请求超时，请稍后重试";
  if (normalized.includes("failed to fetch") || normalized.includes("network request failed") || normalized.includes("networkerror") || normalized.includes("fetch failed")) return "无法连接服务器，请检查网络或数据源地址";

  const httpStatus = normalized.match(/http\s*(\d{3})/i)?.[1];
  if (httpStatus === "401" || httpStatus === "403") return `接口无访问权限（HTTP ${httpStatus}）`;
  if (httpStatus === "404") return "接口地址不存在或已变更（HTTP 404）";
  if (httpStatus?.startsWith("5")) return `服务器暂时不可用（HTTP ${httpStatus}）`;
  if (httpStatus) return `服务器返回异常（HTTP ${httpStatus}）`;

  return fallback;
}
