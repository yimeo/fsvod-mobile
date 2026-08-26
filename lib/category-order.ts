import type { MacCmsCategory } from "@/lib/maccms";

export function sortCategoriesByOrder(categories: MacCmsCategory[], order: string[]): MacCmsCategory[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...categories].sort((left, right) => {
    const leftRank = rank.get(left.id);
    const rightRank = rank.get(right.id);
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return 0;
  });
}

export function promoteCategoryId(order: string[], categoryId: string): string[] {
  return [categoryId, ...order.filter((id) => id !== categoryId)];
}
