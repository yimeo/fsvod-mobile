import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { VodCard } from "@/components/vod-card";
import { fetchVodPage, mergeMacCmsPages, type MacCmsCategory, type MacCmsVod } from "@/lib/maccms";
import { useVodSource } from "@/lib/vod-context";

const ALL_CATEGORY: MacCmsCategory = { id: "all", name: "全部", parentId: null, children: [] };

export default function HomeScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ typeId?: string }>();
  const { endpoint, categories, isBooting, sourceError, refreshCategories } = useVodSource();
  const [activeRootId, setActiveRootId] = useState("all");
  const [activeTypeId, setActiveTypeId] = useState<string | undefined>();
  const [items, setItems] = useState<MacCmsVod[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const rootCategories = useMemo(() => [ALL_CATEGORY, ...categories], [categories]);
  const selectedRoot = useMemo(() => rootCategories.find((category) => category.id === activeRootId) ?? ALL_CATEGORY, [activeRootId, rootCategories]);
  const childCategories = useMemo(() => selectedRoot.children, [selectedRoot]);
  const childCategoryChoices = useMemo(
    () => selectedRoot.id === "all" ? [] : [{ id: selectedRoot.id, name: "全部内容", parentId: null, children: [] }, ...childCategories],
    [childCategories, selectedRoot.id],
  );

  useEffect(() => {
    const targetTypeId = Array.isArray(routeParams.typeId) ? routeParams.typeId[0] : routeParams.typeId;
    if (!targetTypeId) return;
    const root = categories.find((category) => category.id === targetTypeId)
      ?? categories.find((category) => category.children.some((child) => child.id === targetTypeId));
    if (!root) return;
    setActiveRootId(root.id);
    setActiveTypeId(targetTypeId);
  }, [categories, routeParams.typeId]);

  const loadPage = useCallback(async (requestedPage: number, append = false) => {
    if (!endpoint) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const shouldAggregateChildren = activeRootId !== "all" && activeTypeId === selectedRoot.id && selectedRoot.children.length > 0;
      const result = shouldAggregateChildren
        ? mergeMacCmsPages(await Promise.all([selectedRoot, ...selectedRoot.children].map((category) => fetchVodPage(endpoint, { page: requestedPage, typeId: category.id }))))
        : await fetchVodPage(endpoint, { page: requestedPage, typeId: activeTypeId });
      setItems((current) => append ? [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))] : result.items);
      setPage(result.page);
      setPageCount(result.pageCount);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "影视列表加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [activeRootId, activeTypeId, endpoint, selectedRoot]);

  useEffect(() => {
    if (endpoint) void loadPage(1);
  }, [endpoint, activeTypeId, loadPage]);

  const chooseRoot = (id: string) => {
    setActiveRootId(id);
    setActiveTypeId(id === "all" ? undefined : id);
  };

  const chooseChild = (id: string) => setActiveTypeId(id);

  const refresh = async () => {
    setIsRefreshing(true);
    await Promise.all([loadPage(1), refreshCategories()]);
    setIsRefreshing(false);
  };

  if (isBooting) {
    return <ScreenContainer containerClassName="bg-background" className="items-center justify-center"><ActivityIndicator color="#F5B64B" size="large" /></ScreenContainer>;
  }

  if (!endpoint) {
    return (
      <ScreenContainer className="px-6 pt-8" containerClassName="bg-background">
        <View style={styles.emptyHero}>
          <Image source={require("@/assets/images/icon.png")} style={styles.brandMark} />
          <Text style={styles.emptyTitle}>接入你的影视数据源</Text>
          <Text style={styles.emptyText}>填入 MACCMS 站点域名后，飞鸿影院会自动识别数据接口和影视分类。</Text>
          <Pressable onPress={() => router.push("/settings" as never)} style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}>
            <Text style={styles.primaryButtonText}>配置数据源</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <View><Text style={styles.eyebrow}>飞鸿影院</Text><Text style={styles.heading}>发现好电影</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="打开搜索" onPress={() => router.push("/search" as never)} style={({ pressed }) => [styles.searchButton, pressed && styles.buttonPressed]}>
          <Text style={styles.searchIcon}>⌕</Text>
        </Pressable>
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={rootCategories}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.categoryList}
        renderItem={({ item }) => <CategoryChip label={item.name} active={activeRootId === item.id} onPress={() => chooseRoot(item.id)} />}
      />
      {childCategoryChoices.length > 0 ? (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={childCategoryChoices}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.subcategoryList}
          renderItem={({ item }) => <CategoryChip label={item.name} compact active={activeTypeId === item.id} onPress={() => chooseChild(item.id)} />}
        />
      ) : null}
      <View style={styles.sectionRow}><Text style={styles.sectionTitle}>{activeTypeId === selectedRoot.id && selectedRoot.children.length > 0 ? `${selectedRoot.name} · 全部内容` : activeTypeId ? (childCategories.find((item) => item.id === activeTypeId)?.name ?? selectedRoot.name) : selectedRoot.name}</Text><Text style={styles.sectionMeta}>实时数据</Text></View>
      {sourceError ? <Text style={styles.warning}>{sourceError}</Text> : null}
      {loadError ? <Text style={styles.warning}>{loadError}</Text> : null}
    </View>
  );

  return (
    <ScreenContainer containerClassName="bg-background">
      <FlatList
        data={items}
        numColumns={2}
        key="vod-grid"
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <View style={styles.gridCell}><VodCard item={item} onPress={(vod) => router.push({ pathname: "/vod/[id]", params: { id: vod.id } } as never)} /></View>}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={!isLoading ? <View style={styles.noResults}><Text style={styles.noResultsTitle}>暂无可展示影片</Text><Text style={styles.noResultsText}>请切换分类，或在设置中确认数据源接口可访问。</Text></View> : null}
        ListFooterComponent={isLoading ? <View style={styles.footer}><ActivityIndicator color="#F5B64B" /></View> : page < pageCount ? <Pressable style={({ pressed }) => [styles.moreButton, pressed && styles.buttonPressed]} onPress={() => void loadPage(page + 1, true)}><Text style={styles.moreText}>加载更多</Text></Pressable> : items.length > 0 ? <Text style={styles.endText}>已经到底了</Text> : null}
        contentContainerStyle={styles.content}
        columnWrapperStyle={items.length ? styles.gridRow : undefined}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor="#F5B64B" colors={["#F5B64B"]} />}
        onEndReached={() => { if (!isLoading && page < pageCount) void loadPage(page + 1, true); }}
        onEndReachedThreshold={0.7}
        showsVerticalScrollIndicator={false}
      />
    </ScreenContainer>
  );
}

function CategoryChip({ label, active, compact = false, onPress }: { label: string; active: boolean; compact?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, compact && styles.chipCompact, active && styles.chipActive, pressed && styles.buttonPressed]}><Text style={[styles.chipText, compact && styles.chipTextCompact, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 32 },
  header: { paddingTop: 16, paddingBottom: 19, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { fontSize: 10, color: "#F5B64B", letterSpacing: 1.7, fontWeight: "800", lineHeight: 14 },
  heading: { color: "#F6F7FB", fontSize: 27, lineHeight: 35, fontWeight: "800", marginTop: 2 },
  searchButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#151E34", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#283452" },
  searchIcon: { color: "#F6F7FB", fontWeight: "700", fontSize: 28, lineHeight: 30, transform: [{ rotate: "-20deg" }] },
  categoryList: { paddingRight: 18, paddingBottom: 14, gap: 9 },
  subcategoryList: { paddingRight: 18, paddingBottom: 18, gap: 8 },
  chip: { backgroundColor: "#151E34", paddingHorizontal: 15, height: 34, justifyContent: "center", borderRadius: 11, borderWidth: 1, borderColor: "#283452" },
  chipCompact: { height: 30, paddingHorizontal: 12, backgroundColor: "#11192B" },
  chipActive: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  chipText: { color: "#C1C9D9", fontWeight: "700", fontSize: 13, lineHeight: 18 },
  chipTextCompact: { fontSize: 12 },
  chipTextActive: { color: "#11192B" },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 15 },
  sectionTitle: { color: "#F6F7FB", fontWeight: "800", fontSize: 19, lineHeight: 26 },
  sectionMeta: { color: "#5DB7FF", fontSize: 12, fontWeight: "600" },
  warning: { color: "#F8C174", fontSize: 12, lineHeight: 18, backgroundColor: "#2B2630", padding: 10, borderRadius: 10, marginBottom: 12 },
  gridRow: { gap: 13 },
  gridCell: { flex: 1, maxWidth: "50%" },
  footer: { paddingVertical: 20, alignItems: "center" },
  moreButton: { alignSelf: "center", paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#2D3B5D", marginBottom: 9 },
  moreText: { color: "#DDE5F5", fontWeight: "700", fontSize: 13 },
  endText: { color: "#66728A", textAlign: "center", paddingTop: 4, paddingBottom: 12, fontSize: 12 },
  noResults: { paddingVertical: 48, alignItems: "center", paddingHorizontal: 28 },
  noResultsTitle: { color: "#E7EAF0", fontWeight: "700", fontSize: 16, lineHeight: 23 },
  noResultsText: { color: "#9CA7BE", textAlign: "center", marginTop: 7, fontSize: 13, lineHeight: 20 },
  emptyHero: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 70 },
  brandMark: { height: 80, width: 80, borderRadius: 24, marginBottom: 26, shadowColor: "#F5B64B", shadowOpacity: 0.25, shadowRadius: 20 },
  emptyTitle: { color: "#F6F7FB", fontWeight: "800", fontSize: 23, lineHeight: 31, textAlign: "center" },
  emptyText: { color: "#9CA7BE", fontSize: 14, lineHeight: 22, textAlign: "center", marginTop: 10, maxWidth: 290 },
  primaryButton: { marginTop: 25, backgroundColor: "#F5B64B", paddingHorizontal: 20, height: 46, justifyContent: "center", borderRadius: 13 },
  primaryButtonText: { color: "#10182B", fontWeight: "800", fontSize: 14 },
  buttonPressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
});
