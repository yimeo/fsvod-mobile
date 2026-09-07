import { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { PlatformPressable } from "@react-navigation/elements";
import * as Haptics from "expo-haptics";
import { useRef } from "react";
import { emitTabRefresh, type RefreshTab } from "@/lib/tab-refresh";

export function HapticTab(props: BottomTabBarButtonProps & { tabKey?: RefreshTab }) {
  const lastPressAt = useRef(0);
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === "ios") {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        const now = Date.now();
        if (props.tabKey && now - lastPressAt.current < 350) emitTabRefresh(props.tabKey);
        lastPressAt.current = now;
        props.onPressIn?.(ev);
      }}
    />
  );
}
