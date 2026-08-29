export type SourceType = "official" | "custom";

export function getSourceTypeLabel(source: { sourceType?: SourceType }): "官方" | "普通" {
  return source.sourceType === "official" ? "官方" : "普通";
}
