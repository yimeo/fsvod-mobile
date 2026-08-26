import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { VodPoster } from "@/components/vod-poster";
import { sortCategoriesByOrder, promoteCategoryId } from "@/lib/category-order";
import { fetchVodPage, type MacCmsCategory } from "@/lib/maccms";
import { getCategoryOrder, saveCategoryOrder } from "@/lib/vod-storage";
import { useVodSource } from "@/lib/vod-context";

interface CategoryPreview {
  total: number | null;
  posterUrl: string | null;
}

export default function CategoriesScreen() {
  const router = useRouter();
  const { endpoint, categories, isBooting } = useVodSource();
  const [previews, setPreviews] = useState<Record<string, CategoryPreview>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [isLoadingPreviews, setIsLoadingPreviews] = useState(false);

  useEffect(() => { void getCategoryOrder().then(setCategoryOrder); }, []);

  useEffect(() => {
    if (!endpoint || categories.length === 0) return;
    let cancelled = false;
    const loadPreviews = async () => {
      setIsLoadingPreviews(true);
      const settled = await Promise.allSettled(categories.map(async (category) => {
        const page = await fetchVodPage(endpoint, { page: 1, typeId: category.id });
        return [category.id, { total: page.total, posterUrl: page.items[0]?.posterUrl ?? null }] as const;
      }));
      if (cancelled) return;
      const next: Record<string, CategoryPreview> = {};
      settled.forEach((result) => {
        if (result.status === "fulfilled") next[result.value[0]] = result.value[1];
      });
      setPreviews(next);
      setIsLoadingPreviews(false);
    };
    void loadPreviews();
    return () => { cancelled = true; };
  }, [categories, endpoint]);

  const orderedCategories = useMemo(() => sortCategoriesByOrder(categories, categoryOrder), [categories, categoryOrder]);

  const rememberCategory = useCallback(async (categoryId: string) => {
    const next = promoteCategoryId(categoryOrder, categoryId);
    setCategoryOrder(next);
    await saveCategoryOrder(next);
  }, [categoryOrder]);

  const openCategory = async (categoryId: string) => {
    await rememberCategory(categoryId);
    router.navigate({ pathname: "/", params: { typeId: categoryId } } as never);
  };

  if (!endpoint && !isBooting) {
    return (
      <ScreenContainer className="px-6" containerClassName="bg-background">
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>配置后显示全部分类</Text>
          <Text style={styles.emptyText}>连接 MACCMS 数据源后，这里会自动展示站点的一级影视分类、封面、影片数量与二级分类。</Text>
          <Pressable onPress={() => router.navigate("/settings" as never)} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}><Text style={styles.primaryText}>配置数据源</Text></Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-background">
      <FlatList
        data={orderedCategories}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<View><Text style={styles.eyebrow}>EXPLORE CATEGORIES</Text><Text style={styles.heading}>影视分类</Text><Text style={styles.intro}>分类封面与影片总量按当前数据源动态加载。访问或置顶常用分类后，排序会自动保存在本机。</Text>{isLoadingPreviews ? <View style={styles.loadingRow}><ActivityIndicator color="#F5B64B" size="small" /><Text style={styles.loadingText}>正在读取分类封面与影片数量…</Text></View> : null}</View>}
        renderItem={({ item, index }) => <CategoryCard category={item} index={index} preview={previews[item.id]} expanded={expandedId === item.id} onToggle={() => setExpandedId((current) => current === item.id ? null : item.id)} onOpen={() => void openCategory(item.id)} onOpenChild={(id) => void openCategory(id)} onPromote={() => void rememberCategory(item.id)} />}
        ListEmptyComponent={!isBooting ? <View style={styles.noData}><Text style={styles.noDataTitle}>暂无一级分类</Text><Text style={styles.noDataText}>当前数据源尚未返回分类信息。请在设置中重新识别，或先浏览首页数据。</Text></View> : null}
      />
    </ScreenContainer>
  );
}

function CategoryCard({ category, index, preview, expanded, onToggle, onOpen, onOpenChild, onPromote }: { category: MacCmsCategory; index: number; preview?: CategoryPreview; expanded: boolean; onToggle: () => void; onOpen: () => void; onOpenChild: (id: string) => void; onPromote: () => void }) {
  const hasChildren = category.children.length > 0;
  const tones = [styles.toneGold, styles.toneBlue, styles.toneViolet, styles.toneTeal];
  const amount = preview?.total === null || preview?.total === undefined ? "统计中" : `${preview.total} 部`;
  return (
    <View style={[styles.card, tones[index % tones.length]]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`查看 ${category.name} 分类内容`} onPress={onOpen} style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}>
        <VodPoster title={category.name} url={preview?.posterUrl ?? null} style={styles.cover} />
        <View style={styles.cardInfo}>
          <View style={styles.cardTop}><View style={styles.ordinal}><Text style={styles.ordinalText}>{String(index + 1).padStart(2, "0")}</Text></View><Text style={styles.amount}>{amount}</Text></View>
          <Text style={styles.cardTitle}>{category.name}</Text>
          <Text numberOfLines={2} style={styles.summary}>{hasChildren ? `含 ${category.children.length} 个二级分类，可展开查看。` : "来自当前数据源的一级影视内容。"}</Text>
          <Text style={styles.openText}>进入该分类 ›</Text>
        </View>
      </Pressable>
      <View style={styles.tools}>
        {hasChildren ? <Pressable onPress={onToggle} style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]}><Text style={styles.toolText}>{expanded ? "收起二级分类" : `展开二级分类 (${category.children.length})`}</Text></Pressable> : <View />}
        <Pressable onPress={onPromote} style={({ pressed }) => [styles.pinButton, pressed && styles.pressed]}><Text style={styles.pinText}>置顶常用</Text></Pressable>
      </View>
      {expanded ? <View style={styles.children}><Text style={styles.childrenTitle}>二级分类</Text><View style={styles.childRow}>{category.children.map((child) => <Pressable key={child.id} onPress={() => onOpenChild(child.id)} style={({ pressed }) => [styles.childChip, pressed && styles.pressed]}><Text numberOfLines={1} style={styles.childText}>{child.name}</Text></Pressable>)}</View></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 34 },
  eyebrow: { color: "#F5B64B", letterSpacing: 1.6, fontSize: 10, lineHeight: 15, fontWeight: "800", paddingTop: 16 },
  heading: { color: "#F6F7FB", fontWeight: "800", fontSize: 27, lineHeight: 35, marginTop: 3 },
  intro: { color: "#9CA7BE", fontSize: 13, lineHeight: 21, marginTop: 8, marginBottom: 14 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 15 },
  loadingText: { color: "#A8B5C9", fontSize: 11, lineHeight: 17 },
  card: { borderRadius: 17, marginBottom: 12, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  toneGold: { backgroundColor: "#292541" },
  toneBlue: { backgroundColor: "#162D4A" },
  toneViolet: { backgroundColor: "#30213F" },
  toneTeal: { backgroundColor: "#15363A" },
  cardMain: { padding: 13, flexDirection: "row", gap: 13 },
  cover: { width: 92, height: 124, borderRadius: 12, flexShrink: 0 },
  cardInfo: { flex: 1, minWidth: 0, justifyContent: "center" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ordinal: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, minWidth: 34, height: 25, justifyContent: "center", alignItems: "center" },
  ordinalText: { color: "#F8D28D", fontWeight: "800", fontSize: 11, letterSpacing: 0.6 },
  amount: { color: "#B9D9FA", fontWeight: "800", fontSize: 12, lineHeight: 18 },
  cardTitle: { color: "#F6F7FB", fontSize: 21, lineHeight: 28, fontWeight: "800", marginTop: 10 },
  summary: { color: "#C4CDDC", fontSize: 12, lineHeight: 19, marginTop: 4 },
  openText: { color: "#F8D28D", fontSize: 12, lineHeight: 18, fontWeight: "800", marginTop: 9 },
  tools: { minHeight: 43, paddingHorizontal: 13, paddingBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  toolButton: { height: 31, justifyContent: "center", paddingHorizontal: 10, borderRadius: 9, backgroundColor: "rgba(11,16,32,0.36)" },
  toolText: { color: "#CFDBEA", fontSize: 11, lineHeight: 16, fontWeight: "700" },
  pinButton: { height: 31, justifyContent: "center", paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: "rgba(245,182,75,0.55)" },
  pinText: { color: "#F8D28D", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  children: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(11,16,32,0.20)", padding: 13 },
  childrenTitle: { color: "#E4EAF3", fontWeight: "800", fontSize: 12, lineHeight: 18, marginBottom: 8 },
  childRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  childChip: { maxWidth: 120, backgroundColor: "rgba(11,16,32,0.50)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  childText: { color: "#DCE7F5", fontSize: 11, lineHeight: 15, fontWeight: "700" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 70 },
  emptyTitle: { color: "#F6F7FB", fontSize: 19, lineHeight: 26, fontWeight: "800", textAlign: "center" },
  emptyText: { color: "#9CA7BE", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8, maxWidth: 295 },
  primaryButton: { height: 44, paddingHorizontal: 17, borderRadius: 12, justifyContent: "center", backgroundColor: "#F5B64B", marginTop: 20 },
  primaryText: { color: "#11192B", fontSize: 13, fontWeight: "800" },
  noData: { alignItems: "center", paddingVertical: 52, paddingHorizontal: 26 },
  noDataTitle: { color: "#E8ECF3", fontSize: 16, lineHeight: 23, fontWeight: "700" },
  noDataText: { color: "#9CA7BE", fontSize: 13, lineHeight: 20, marginTop: 7, textAlign: "center" },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
});
