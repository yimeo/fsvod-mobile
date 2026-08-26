import type { MacCmsCategory } from "@/lib/maccms";

export function sortCategoriesByOrder(categories: MacCmsCategory[], order: string[]): MacCmsCategory[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  return [...categories].sort((left, right) => {
    const leftRank = rank.get(left.id);
    const rightRank = rank.get(right.id);
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    const nameOrder = collator.compare(left.name, right.name);
    return nameOrder || String(left.id).localeCompare(String(right.id), "zh-CN", { numeric: true });
  });
}

export function promoteCategoryId(order: string[], categoryId: string): string[] {
  return [categoryId, ...order.filter((id) => id !== categoryId)];
}
