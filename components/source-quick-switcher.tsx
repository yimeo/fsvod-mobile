import { useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { type SavedMacCmsSource } from "@/lib/vod-storage";
import { useVodSource } from "@/lib/vod-context";

interface SourceQuickSwitcherProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

function getSourceName(source: SavedMacCmsSource): string {
  return source.displayName?.trim() || source.endpoint.inputDomain || "未命名资源";
}

function getHealthLabel(source: SavedMacCmsSource): string {
  if (source.health === "healthy") return `数据正常 · ${source.lastDataCount ?? 0} 部`;
  if (source.health === "unhealthy") return source.lastError || "数据验证失败";
  return "尚未验证数据";
}

export function SourceQuickSwitcher({ children, style }: SourceQuickSwitcherProps) {
  const { endpoint, sources, switchSource } = useVodSource();
  const [visible, setVisible] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchMessage, setSwitchMessage] = useState<string | null>(null);
  const orderedSources = useMemo(() => [...sources], [sources]);

  const isActive = (source: SavedMacCmsSource) => endpoint?.apiUrl === source.id || endpoint?.apiUrl === source.endpoint.apiUrl;
  const selectSource = async (source: SavedMacCmsSource) => {
    if (isActive(source) || switchingId) return;
    setSwitchMessage(null);
    setSwitchingId(source.id);
    try {
      const switched = await switchSource(source.id);
      if (switched) {
        setVisible(false);
      } else {
        setSwitchMessage(`“${getSourceName(source)}”连接异常，已保留当前正在使用的资源。`);
      }
    } catch {
      setSwitchMessage(`“${getSourceName(source)}”连接异常，已保留当前正在使用的资源。`);
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="快速切换数据源"
        onPress={() => {
          setSwitchMessage(null);
          setVisible(true);
        }}
        style={({ pressed }) => [style, pressed && styles.triggerPressed]}
      >
        {children}
      </Pressable>
      <Modal transparent animationType="fade" visible={visible} onRequestClose={() => setVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="关闭数据源选择" style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.title}>快速切换资源</Text>
                <Text style={styles.subtitle}>必须验证到有效影视数据后才会切换当前资源</Text>
              </View>
              <Pressable accessibilityLabel="关闭" onPress={() => setVisible(false)} style={({ pressed }) => [styles.closeButton, pressed && styles.triggerPressed]}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {switchMessage ? <Text style={styles.switchMessage}>{switchMessage}</Text> : null}
            <FlatList
              data={orderedSources}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.sourceList}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={<Text style={styles.emptyText}>暂未保存可切换的数据源。</Text>}
              renderItem={({ item }) => {
                const active = isActive(item);
                const switching = switchingId === item.id;
                const healthLabel = getHealthLabel(item);
                const statusLabel = switching ? "正在验证连接…" : active ? `当前使用 · ${healthLabel}` : healthLabel;
                return (
                  <Pressable
                    disabled={active || Boolean(switchingId)}
                    onPress={() => void selectSource(item)}
                    style={({ pressed }) => [styles.sourceOption, active && styles.sourceOptionActive, item.health === "unhealthy" && styles.sourceOptionUnhealthy, (pressed || switching) && styles.triggerPressed]}
                  >
                    <View style={[styles.statusDot, item.health === "healthy" && styles.statusDotHealthy, item.health === "unhealthy" && styles.statusDotUnhealthy]} />
                    <View style={styles.optionCopy}>
                      <View style={styles.optionNameRow}>
                        <Text numberOfLines={1} style={styles.optionName}>{getSourceName(item)}</Text>
                        {item.sourceType === "official" ? <Text style={styles.officialTag}>官方</Text> : null}
                      </View>
                      <Text numberOfLines={1} style={[styles.optionStatus, item.health === "unhealthy" && styles.optionStatusUnhealthy]}>{statusLabel}</Text>
                    </View>
                    {switching ? <ActivityIndicator size="small" color="#FFB84D" /> : active ? <Text style={styles.currentLabel}>当前使用</Text> : <Text style={item.health === "unhealthy" ? styles.errorLabel : styles.chooseLabel}>{item.health === "unhealthy" ? "异常" : item.health === "healthy" ? "选择" : "待验证"}</Text>}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  triggerPressed: { opacity: 0.68 },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2, 6, 15, 0.68)", padding: 18 },
  sheet: { maxHeight: "72%", borderRadius: 22, padding: 18, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#34425C" },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  title: { color: "#F5F7FB", fontSize: 19, lineHeight: 26, fontWeight: "900" },
  subtitle: { color: "#98A6BB", fontSize: 11, lineHeight: 16, marginTop: 2 },
  closeButton: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#232E44", alignItems: "center", justifyContent: "center" },
  closeText: { color: "#DDE5F0", fontSize: 25, lineHeight: 27, fontWeight: "300", marginTop: -2 },
  switchMessage: { color: "#F4B192", fontSize: 11, lineHeight: 17, padding: 10, borderRadius: 10, backgroundColor: "#362934", marginBottom: 10 },
  sourceList: { gap: 9, paddingBottom: 2 },
  sourceOption: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, borderRadius: 14, backgroundColor: "#1D2940", borderWidth: 1, borderColor: "#30405B" },
  sourceOptionActive: { backgroundColor: "#1E403A", borderColor: "#45806B" },
  sourceOptionUnhealthy: { backgroundColor: "#30252E", borderColor: "#724653" },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#77869D", flexShrink: 0 },
  statusDotHealthy: { backgroundColor: "#78D3A4" },
  statusDotUnhealthy: { backgroundColor: "#F39A79" },
  optionCopy: { flex: 1, minWidth: 0 },
  optionNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  optionName: { color: "#F0F4F9", fontSize: 14, lineHeight: 20, fontWeight: "900", flexShrink: 1 },
  officialTag: { color: "#B8F1E0", backgroundColor: "#1E554B", fontSize: 9, lineHeight: 14, fontWeight: "900", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  optionStatus: { color: "#9EB3C9", fontSize: 10, lineHeight: 15, marginTop: 2 },
  optionStatusUnhealthy: { color: "#F0AB91" },
  currentLabel: { color: "#A7E5C0", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  chooseLabel: { color: "#F6C36B", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  errorLabel: { color: "#F2A17F", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  emptyText: { color: "#9BA8BB", textAlign: "center", paddingVertical: 26, fontSize: 12, lineHeight: 18 },
});
