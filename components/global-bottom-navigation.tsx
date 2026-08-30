import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";

const NAV_ITEMS = [
  { label: "首页", icon: "house.fill", href: "/" },
  { label: "分类", icon: "film.fill", href: "/categories" },
  { label: "搜索", icon: "magnifyingglass", href: "/search" },
  { label: "我的", icon: "person.crop.circle.fill", href: "/settings" },
] as const;

export function GlobalBottomNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const selectedHref = pathname.startsWith("/vod/") || pathname === "/player" ? "/" : pathname;

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 9), height: 56 + Math.max(insets.bottom, 9) }]}>
      {NAV_ITEMS.map((item) => {
        const active = selectedHref === item.href;
        return (
          <Pressable key={item.href} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={item.label} onPress={() => router.navigate(item.href as never)} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
            <View style={[styles.iconShell, active && styles.iconShellActive]}><IconSymbol name={item.icon} size={21} color={active ? "#F5B64B" : "#A0AEC0"} /></View>
            <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#0B1020", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#2B3958", flexDirection: "row", alignItems: "flex-start", paddingTop: 8, shadowColor: "#000000", shadowOpacity: 0.3, shadowRadius: 12, elevation: 12 },
  item: { flex: 1, alignItems: "center", gap: 1, paddingTop: 0 },
  iconShell: { width: 31, height: 29, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  iconShellActive: { backgroundColor: "#222C45", borderWidth: 1, borderColor: "#3C4D70" },
  label: { color: "#8E9AB0", fontSize: 11, lineHeight: 16, fontWeight: "600" },
  labelActive: { color: "#F5B64B", fontWeight: "800" },
  pressed: { opacity: 0.68, transform: [{ scale: 0.97 }] },
});
