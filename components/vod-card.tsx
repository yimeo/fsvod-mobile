import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MacCmsVod } from "@/lib/maccms";
import { VodPoster } from "@/components/vod-poster";

interface VodCardProps {
  item: MacCmsVod;
  onPress: (item: MacCmsVod) => void;
}

export function VodCard({ item, onPress }: VodCardProps) {
  const subtitle = [item.year, item.area].filter(Boolean).join(" · ") || item.typeName || "影视";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看 ${item.name}`}
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <VodPoster title={item.name} url={item.posterUrl} style={styles.poster} />
      {item.remarks ? <View style={styles.remark}><Text numberOfLines={1} style={styles.remarkText}>{item.remarks}</Text></View> : null}
      <Text numberOfLines={1} style={styles.title}>{item.name}</Text>
      <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, marginBottom: 20 },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  poster: { width: "100%", aspectRatio: 2 / 3, borderRadius: 12, backgroundColor: "#151E34" },
  remark: { position: "absolute", right: 7, top: 8, maxWidth: "76%", borderRadius: 7, backgroundColor: "rgba(11,16,32,0.82)", paddingHorizontal: 7, paddingVertical: 4 },
  remarkText: { color: "#F8D28D", fontWeight: "700", fontSize: 10, lineHeight: 14 },
  title: { color: "#F6F7FB", fontWeight: "700", marginTop: 9, fontSize: 14, lineHeight: 20 },
  subtitle: { color: "#9CA7BE", marginTop: 2, fontSize: 12, lineHeight: 17 },
});
