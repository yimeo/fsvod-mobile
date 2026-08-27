import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { fetchVodPage, type MacCmsCategory, type MacCmsVod } from "@/lib/maccms";
import { useVodSource } from "@/lib/vod-context";

const ALL = "all";

export default function CategoriesScreen() {
  const router = useRouter();
  const { endpoint, categories, isBooting } = useVodSource();
  const [rootId, setRootId] = useState(ALL);
  const [childId, setChildId] = useState(ALL);
  const [area, setArea] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [sample, setSample] = useState<MacCmsVod[]>([]);
  const [loading, setLoading] = useState(false);

  const root = useMemo(() => categories.find((category) => category.id === rootId) ?? null, [categories, rootId]);
  const childOptions = useMemo(() => root ? [{ id: root.id, name: "全部" }, ...root.children] : [], [root]);
  const areas = useMemo(() => [...new Set(sample.map((item) => item.area).filter(Boolean))].slice(0, 8), [sample]);
  const years = useMemo(() => [...new Set(sample.map((item) => item.year).filter(Boolean))].sort((a, b) => b.localeCompare(a)).slice(0, 8), [sample]);

  useEffect(() => {
    if (rootId === ALL && categories[0]) {
      setRootId(categories[0].id);
      setChildId(categories[0].id);
    }
  }, [categories, rootId]);

  useEffect(() => {
    if (!endpoint || rootId === ALL) { setSample([]); return; }
    let cancelled = false;
    setLoading(true);
    void fetchVodPage(endpoint, { page: 1, typeId: rootId })
      .then((page) => { if (!cancelled) setSample(page.items); })
      .catch(() => { if (!cancelled) setSample([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [endpoint, rootId]);

  const chooseRoot = useCallback((id: string) => {
    setRootId(id);
    setChildId(id);
    setArea(ALL);
    setYear(ALL);
  }, []);

  const apply = () => {
    const typeId = childId !== ALL ? childId : rootId !== ALL ? rootId : undefined;
    router.navigate({ pathname: "/", params: { ...(typeId ? { typeId } : {}), ...(area !== ALL ? { area } : {}), ...(year !== ALL ? { year } : {}) } } as never);
  };

  if (!endpoint && !isBooting) return <ScreenContainer className="px-6" containerClassName="bg-background"><View style={styles.empty}><Text style={styles.emptyTitle}>先连接一个数据源</Text><Text style={styles.emptyText}>配置 MACCMS 数据源后，即可按分类、地区和年份快速筛选。</Text><Pressable onPress={() => router.navigate("/settings" as never)} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}><Text style={styles.primaryText}>去添加数据源</Text></Pressable></View></ScreenContainer>;

  return <ScreenContainer containerClassName="bg-background"><FlatList data={[]} keyExtractor={(_, index) => String(index)} renderItem={() => null} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} ListHeaderComponent={<View><Text style={styles.eyebrow}>BROWSE & FILTER</Text><Text style={styles.heading}>分类筛选</Text><Text style={styles.lead}>用更少的操作，找到现在想看的内容。</Text><FilterSection title="一级分类"><FlatList horizontal data={categories} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipList} renderItem={({ item }) => <FilterChip label={item.name} active={rootId === item.id} onPress={() => chooseRoot(item.id)} />} /></FilterSection>{root ? <FilterSection title="二级分类"><FlatList horizontal data={childOptions} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipList} renderItem={({ item }) => <FilterChip label={item.name} active={childId === item.id} onPress={() => setChildId(item.id)} />} /></FilterSection> : null}<FilterSection title="地区">{loading ? <ActivityIndicator color="#F5B64B" size="small" /> : <FlatList horizontal data={["全部", ...areas]} keyExtractor={(item) => item} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipList} renderItem={({ item }) => <FilterChip label={item} active={area === (item === "全部" ? ALL : item)} onPress={() => setArea(item === "全部" ? ALL : item)} />} />}</FilterSection><FilterSection title="年份"><FlatList horizontal data={["全部", ...years]} keyExtractor={(item) => item} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipList} renderItem={({ item }) => <FilterChip label={item} active={year === (item === "全部" ? ALL : item)} onPress={() => setYear(item === "全部" ? ALL : item)} />} /></FilterSection><View style={styles.summary}><Text style={styles.summaryLabel}>当前筛选</Text><Text numberOfLines={1} style={styles.summaryText}>{[root?.name, childId !== root?.id ? childOptions.find((item) => item.id === childId)?.name : null, area !== ALL ? area : null, year !== ALL ? year : null].filter(Boolean).join(" · ") || "全部影视"}</Text></View><Pressable onPress={apply} style={({ pressed }) => [styles.applyButton, pressed && styles.pressed]}><Text style={styles.applyText}>查看筛选结果</Text><Text style={styles.applyArrow}>›</Text></Pressable></View>} /></ScreenContainer>;
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) { return <View style={styles.filterSection}><Text style={styles.filterTitle}>{title}</Text>{children}</View>; }
function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 18, paddingTop: 25, paddingBottom: 35 },
  eyebrow: { color: "#F5B64B", letterSpacing: 1.6, fontSize: 10, lineHeight: 15, fontWeight: "900" },
  heading: { color: "#F7F8FC", fontSize: 30, lineHeight: 39, fontWeight: "900", marginTop: 4 },
  lead: { color: "#9DA9BC", fontSize: 13, lineHeight: 21, marginTop: 6 },
  filterSection: { marginTop: 25 },
  filterTitle: { color: "#EDF1F7", fontSize: 15, lineHeight: 21, fontWeight: "900", marginBottom: 10 },
  chipList: { gap: 9, paddingRight: 18 },
  chip: { minHeight: 38, paddingHorizontal: 15, borderRadius: 12, backgroundColor: "#182136", borderWidth: 1, borderColor: "#2E3A55", alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  chipText: { color: "#C3CDDC", fontSize: 12, lineHeight: 17, fontWeight: "800" },
  chipTextActive: { color: "#151923" },
  summary: { marginTop: 31, borderRadius: 14, backgroundColor: "#151E31", padding: 15 },
  summaryLabel: { color: "#8090A8", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  summaryText: { color: "#F0F3F8", fontSize: 15, lineHeight: 22, fontWeight: "800", marginTop: 4 },
  applyButton: { height: 54, borderRadius: 15, backgroundColor: "#F5B64B", marginTop: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  applyText: { color: "#121722", fontSize: 15, lineHeight: 22, fontWeight: "900" },
  applyArrow: { color: "#121722", fontSize: 27, lineHeight: 28, marginTop: -4 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 80 },
  emptyTitle: { color: "#F2F4F8", fontSize: 20, lineHeight: 28, fontWeight: "900" },
  emptyText: { color: "#9CA7BE", maxWidth: 295, textAlign: "center", fontSize: 13, lineHeight: 21, marginTop: 8 },
  primaryButton: { marginTop: 20, height: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#F5B64B", justifyContent: "center" },
  primaryText: { color: "#111925", fontWeight: "900", fontSize: 13 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
});
