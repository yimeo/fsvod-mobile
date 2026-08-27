import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { VodCard } from "@/components/vod-card";
import { fetchVodPage, mergeMacCmsPages, type MacCmsCategory, type MacCmsVod } from "@/lib/maccms";
import { useVodSource } from "@/lib/vod-context";

const EMPTY_CATEGORY: MacCmsCategory = { id: "", name: "", parentId: null, children: [] };

export default function CategoriesScreen() {
  const router = useRouter();
  const { endpoint, categories, isBooting } = useVodSource();
  const [rootId, setRootId] = useState("");
  const [childId, setChildId] = useState("");
  const [items, setItems] = useState<MacCmsVod[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const root = useMemo(() => categories.find((category) => category.id === rootId) ?? EMPTY_CATEGORY, [categories, rootId]);
  const selectedTypeId = childId || root.id;
  const childChoices = useMemo(() => root.children.length ? [{ id: root.id, name: "全部", parentId: null, children: [] }, ...root.children] : [], [root]);

  useEffect(() => {
    if (categories.length && !categories.some((category) => category.id === rootId)) {
      setRootId(categories[0].id);
      setChildId(categories[0].id);
    }
  }, [categories, rootId]);

  const loadPage = useCallback(async (requestedPage: number, append = false) => {
    if (!endpoint || !selectedTypeId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const shouldAggregateChildren = selectedTypeId === root.id && root.children.length > 0;
      const result = shouldAggregateChildren
        ? mergeMacCmsPages(await Promise.all([root, ...root.children].map((category) => fetchVodPage(endpoint, { page: requestedPage, typeId: category.id }))))
        : await fetchVodPage(endpoint, { page: requestedPage, typeId: selectedTypeId });
      setItems((current) => append ? [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))] : result.items);
      setPage(result.page);
      setPageCount(result.pageCount);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "分类内容加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [endpoint, root, selectedTypeId]);

  useEffect(() => { if (selectedTypeId) void loadPage(1); }, [loadPage, selectedTypeId]);

  const chooseRoot = (id: string) => {
    setRootId(id);
    setChildId(id);
  };

  const refresh = async () => {
    setIsRefreshing(true);
    await loadPage(1);
    setIsRefreshing(false);
  };

  if (isBooting) return <ScreenContainer containerClassName="bg-background" className="items-center justify-center"><ActivityIndicator size="large" color="#FFB84D" /></ScreenContainer>;
  if (!endpoint) return <ScreenContainer className="px-6" containerClassName="bg-background"><View style={styles.empty}><Text style={styles.emptyTitle}>先连接一个数据源</Text><Text style={styles.emptyText}>添加 MACCMS 数据源后，即可按一级分类和二级分类浏览内容。</Text><Pressable onPress={() => router.navigate("/settings" as never)} style={({ pressed }) => [styles.connectButton, pressed && styles.pressed]}><Text style={styles.connectText}>去添加数据源</Text></Pressable></View></ScreenContainer>;

  const listHeader = <View>
    <Text style={styles.heading}>分类浏览</Text>
    <Text style={styles.brandHint}>飞鸿影院</Text>
    <View style={styles.sectionHead}><Text style={styles.sectionTitle}>主分类</Text><Text style={styles.sectionMeta}>{categories.length} 个分类</Text></View>
    <FlatList horizontal data={categories} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rootList} renderItem={({ item }) => <CategoryPill label={item.name} active={item.id === root.id} onPress={() => chooseRoot(item.id)} />} />
    {root.children.length ? <><View style={styles.sectionHead}><Text style={styles.sectionTitle}>{root.name}的子分类</Text><Text style={styles.sectionMeta}>{root.children.length} 个子分类</Text></View><FlatList horizontal data={childChoices} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.childList} renderItem={({ item }) => <CategoryPill label={item.name} small active={item.id === selectedTypeId} onPress={() => setChildId(item.id)} />} /></> : null}
    <View style={styles.contentHead}><View><Text style={styles.contentTitle}>{childId === root.id ? root.name : childChoices.find((item) => item.id === childId)?.name || root.name}</Text><Text style={styles.contentMeta}>共展示 {items.length} 部影片</Text></View>{isLoading ? <ActivityIndicator size="small" color="#FFB84D" /> : null}</View>
    {loadError ? <Text style={styles.warning}>{loadError}</Text> : null}
  </View>;

  return <ScreenContainer containerClassName="bg-background"><FlatList data={items} numColumns={2} key="category-grid" keyExtractor={(item) => item.id} renderItem={({ item }) => <View style={styles.gridCell}><VodCard item={item} onPress={(vod) => router.push({ pathname: "/vod/[id]", params: { id: vod.id } } as never)} /></View>} ListHeaderComponent={listHeader} ListEmptyComponent={!isLoading ? <View style={styles.noResults}><Text style={styles.noResultsTitle}>暂无影片</Text><Text style={styles.noResultsText}>这个分类暂时没有可展示的内容。</Text></View> : null} ListFooterComponent={isLoading ? <View style={styles.footer}><ActivityIndicator color="#FFB84D" /></View> : page < pageCount ? <Pressable onPress={() => void loadPage(page + 1, true)} style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}><Text style={styles.loadMoreText}>加载更多</Text></Pressable> : items.length ? <Text style={styles.endText}>已经到底了</Text> : null} contentContainerStyle={styles.content} columnWrapperStyle={items.length ? styles.gridRow : undefined} refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor="#FFB84D" colors={["#FFB84D"]} />} onEndReached={() => { if (!isLoading && page < pageCount) void loadPage(page + 1, true); }} onEndReachedThreshold={0.65} showsVerticalScrollIndicator={false} /></ScreenContainer>;
}

function CategoryPill({ label, active, small = false, onPress }: { label: string; active: boolean; small?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.pill, small && styles.pillSmall, active && styles.pillActive, pressed && styles.pressed]}><Text numberOfLines={1} style={[styles.pillText, small && styles.pillTextSmall, active && styles.pillTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 34 },
  heading: { color: "#F8FAFC", fontSize: 30, lineHeight: 38, fontWeight: "900", letterSpacing: -0.7 },
  brandHint: { color: "#8E9AAD", fontSize: 12, lineHeight: 18, marginTop: 3 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 25, marginBottom: 11 },
  sectionTitle: { color: "#EAF0F7", fontSize: 15, lineHeight: 21, fontWeight: "900" },
  sectionMeta: { color: "#8190A7", fontSize: 11, lineHeight: 16, fontWeight: "700" },
  rootList: { gap: 10, paddingRight: 18 },
  childList: { gap: 8, paddingRight: 18 },
  pill: { minWidth: 78, height: 48, paddingHorizontal: 17, justifyContent: "center", alignItems: "center", borderRadius: 24, borderWidth: 1, borderColor: "#303B50", backgroundColor: "#1A2335" },
  pillSmall: { minWidth: 0, height: 39, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#151D2C", borderColor: "#212C40" },
  pillActive: { backgroundColor: "#FFB84D", borderColor: "#FFB84D" },
  pillText: { color: "#D8E0EB", fontSize: 13, lineHeight: 18, fontWeight: "900" },
  pillTextSmall: { color: "#BFCADB", fontSize: 12 },
  pillTextActive: { color: "#171A22" },
  contentHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 27, marginBottom: 16 },
  contentTitle: { color: "#F7F9FC", fontSize: 22, lineHeight: 29, fontWeight: "900" },
  contentMeta: { color: "#8E9AAD", fontSize: 11, lineHeight: 16, marginTop: 2 },
  gridRow: { gap: 14 },
  gridCell: { flex: 1, maxWidth: "50%" },
  footer: { paddingVertical: 20, alignItems: "center" },
  loadMore: { alignSelf: "center", height: 40, paddingHorizontal: 18, justifyContent: "center", borderRadius: 11, borderWidth: 1, borderColor: "#334157", backgroundColor: "#171F2D", marginBottom: 14 },
  loadMoreText: { color: "#F7BE5C", fontSize: 12, lineHeight: 17, fontWeight: "900" },
  endText: { color: "#68778E", textAlign: "center", paddingBottom: 14, fontSize: 12 },
  warning: { color: "#F6C174", backgroundColor: "#2A2630", fontSize: 12, lineHeight: 18, padding: 10, borderRadius: 10, marginBottom: 12 },
  noResults: { alignItems: "center", paddingVertical: 52 },
  noResultsTitle: { color: "#EAF0F7", fontSize: 16, lineHeight: 23, fontWeight: "900" },
  noResultsText: { color: "#8E9AAD", fontSize: 12, lineHeight: 18, marginTop: 4 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 80 },
  emptyTitle: { color: "#F3F6FB", fontSize: 21, lineHeight: 29, fontWeight: "900" },
  emptyText: { color: "#9CA9BB", fontSize: 13, lineHeight: 21, marginTop: 7, textAlign: "center", maxWidth: 290 },
  connectButton: { height: 45, marginTop: 20, paddingHorizontal: 16, justifyContent: "center", borderRadius: 13, backgroundColor: "#FFB84D" },
  connectText: { color: "#171A22", fontSize: 13, fontWeight: "900" },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});
