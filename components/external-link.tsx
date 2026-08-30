import { Href, Link } from "expo-router";
import { Alert, Linking } from "react-native";
import { type ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: Href & string };

export function ExternalLink({ href, ...rest }: Props) {
  return (
    <Link
      target="_blank"
      {...rest}
      href={href}
      onPress={async (event) => {
        if (process.env.EXPO_OS !== "web") {
          // Prevent Expo Router from handling the URL inside the app.
          event.preventDefault();
          Alert.alert("打开外部链接", "将使用手机默认浏览器打开，不会在 App 内打开。", [
            { text: "取消", style: "cancel" },
            { text: "打开浏览器", onPress: () => { void Linking.openURL(href).catch(() => undefined); } },
          ]);
        }
      }}
    />
  );
}
