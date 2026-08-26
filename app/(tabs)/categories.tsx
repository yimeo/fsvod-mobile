import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import type { MacCmsCategory } from "@/lib/maccms";
import { useVodSource } from "@/lib/vod-context";

export default function CategoriesScreen() {
  const router = useRouter();
  const { endpoint, categories, isBooting } = useVodSource();

  const openCategory = (category: MacCmsCategory) => {
    router.navigate({ pathname: "/", params: { typeId: category.id } } as never);
  };

  if (!endpoint && !isBooting) {
    return (
      <ScreenContainer className="px-6" containerClassName="bg-background">
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>配置后显示全部分类</Text>
          <Text style={styles.emptyText}>连接 MACCMS 数据源后，这里会自动展示站点的一级影视分类与分类简介。</Text>
          <Pressable onPress={() => router.navigate("/settings" as never)} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}><Text style={styles.primaryText}>配置数据源</Text></Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-background">
      <FlatList
        data={categories}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<View><Text style={styles.eyebrow}>EXPLORE CATEGORIES</Text><Text style={styles.heading}>影视分类</Text><Text style={styles.intro}>分类来自当前 MACCMS 数据源。选择任一一级分类，即可查看该分类下的影视内容与子分类。</Text></View>}
        renderItem={({ item, index }) => <CategoryCard category={item} index={index} onPress={() => openCategory(item)} />}
        ListEmptyComponent={!isBooting ? <View style={styles.noData}><Text style={styles.noDataTitle}>暂无一级分类</Text><Text style={styles.noDataText}>当前数据源尚未返回分类信息。请在设置中重新识别，或先浏览首页数据。</Text></View> : null}
      />
    </ScreenContainer>
  );
}

function CategoryCard({ category, index, onPress }: { category: MacCmsCategory; index: number; onPress: () => void }) {
  const hasChildren = category.children.length > 0;
  const summary = hasChildren
    ? `包含 ${category.children.length} 个子分类：${category.children.slice(0, 3).map((item) => item.name).join("、")}${category.children.length > 3 ? " 等" : ""}`
    : "来自当前数据源的一级影视内容，进入后可继续筛选与浏览。";
  const tones = [styles.toneGold, styles.toneBlue, styles.toneViolet, styles.toneTeal];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`查看 ${category.name} 分类内容`} onPress={onPress} style={({ pressed }) => [styles.card, tones[index % tones.length], pressed && styles.pressed]}>
      <View style={styles.cardTop}><View style={styles.ordinal}><Text style={styles.ordinalText}>{String(index + 1).padStart(2, "0")}</Text></View><Text style={styles.action}>查看内容 ›</Text></View>
      <Text style={styles.cardTitle}>{category.name}</Text>
      <Text style={styles.summary}>{summary}</Text>
      {hasChildren ? <View style={styles.childRow}>{category.children.slice(0, 4).map((child) => <View key={child.id} style={styles.childChip}><Text numberOfLines={1} style={styles.childText}>{child.name}</Text></View>)}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 34 },
  eyebrow: { color: "#F5B64B", letterSpacing: 1.6, fontSize: 10, lineHeight: 15, fontWeight: "800", paddingTop: 16 },
  heading: { color: "#F6F7FB", fontWeight: "800", fontSize: 27, lineHeight: 35, marginTop: 3 },
  intro: { color: "#9CA7BE", fontSize: 13, lineHeight: 21, marginTop: 8, marginBottom: 20 },
  card: { borderRadius: 17, padding: 16, marginBottom: 12, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  toneGold: { backgroundColor: "#292541" },
  toneBlue: { backgroundColor: "#162D4A" },
  toneViolet: { backgroundColor: "#30213F" },
  toneTeal: { backgroundColor: "#15363A" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ordinal: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, minWidth: 34, height: 25, justifyContent: "center", alignItems: "center" },
  ordinalText: { color: "#F8D28D", fontWeight: "800", fontSize: 11, letterSpacing: 0.6 },
  action: { color: "#B7D8FA", fontWeight: "700", fontSize: 12, lineHeight: 18 },
  cardTitle: { color: "#F6F7FB", fontSize: 21, lineHeight: 28, fontWeight: "800", marginTop: 15 },
  summary: { color: "#C4CDDC", fontSize: 12, lineHeight: 19, marginTop: 5 },
  childRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 13 },
  childChip: { maxWidth: 92, backgroundColor: "rgba(11,16,32,0.42)", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 },
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
