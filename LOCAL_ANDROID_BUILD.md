# 飞鸿影院 Android 本地构建

本说明用于在**自己的 Windows、macOS 或 Linux 电脑**上生成飞鸿影院 Android 测试包，不使用云端构建额度。当前源码要求 Android **minSdk 24**，因此测试设备至少应为 Android 7.0；Android 12 可以直接用于验证播放器修复。

## 1. 准备开发环境

请安装 Node.js 20 或 22、pnpm、Android Studio 和 OpenJDK 17。Android Studio 的 SDK Manager 中应安装 Android SDK Platform 35、Android SDK Build-Tools 35 与 Android SDK Platform-Tools（包含 `adb`）。在 Android Studio 中打开 SDK Manager 可确认 SDK 路径；Windows 常见路径为 `%LOCALAPPDATA%\Android\Sdk`，macOS 常见路径为 `$HOME/Library/Android/sdk`。

| 平台 | 终端示例 |
|---|---|
| Windows PowerShell | `$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"` |
| macOS / Linux | `export ANDROID_HOME="$HOME/Android/Sdk"` |

> 本地调试包由电脑上的 Android SDK 编译，不消耗 Expo 云端构建额度。[1]

## 2. 获取并安装源码依赖

在终端执行以下命令。GitHub 仓库的最新播放器稳定性修复已位于 `main` 分支。

```bash
git clone https://github.com/yimeo/fsvod-mobile.git
cd fsvod-mobile
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm exec vitest run
```

若你希望使用当前管理界面中尚未推送的 Expo 团队归属配置，可通过代码面板下载最新 ZIP，并在解压后的目录继续以下步骤。

## 3. 生成并安装 Android 调试包

连接 Android 手机并开启“开发者选项 → USB 调试”，或先在 Android Studio 创建并启动模拟器。首次构建会生成 `android/` 原生目录、编译 APK、安装到设备并启动 Metro 服务。

```bash
pnpm exec expo run:android --device
```

如果系统未自动识别设备，先执行 `adb devices`，确认设备状态为 `device`，再运行上一条命令。生成后的调试 APK 通常位于：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

也可只生成 APK，不自动安装：

```bash
pnpm exec expo prebuild --platform android --clean
cd android
# Windows
.\gradlew.bat app:assembleDebug
# macOS / Linux
./gradlew app:assembleDebug
```

随后通过 USB 安装：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## 4. 验证播放器闪退修复

安装后，在 Android 12 上依次验证：打开任意影片介绍页，进入播放页但**不等待影片开始播放**，点击另一条播放线路；随后返回播放页并点击左上角“返回”。两项操作均应留在应用内，不应退出或闪退。切换到已开始播放的线路、上一集、下一集和返回介绍页也应分别复测。

## 5. 版本更新后的重新构建

仅改动 TypeScript 或界面时，保留已安装调试包并运行 `pnpm run dev` 即可加载更新。若改动 `app.config.ts`、新增原生模块或升级 Expo 依赖，则重新执行 `pnpm exec expo run:android --device`；如原生目录状态异常，先执行 `pnpm exec expo prebuild --platform android --clean`。[2]

若需发布到 Google Play，请按照 Expo 的本地发布指南创建和保管上传密钥，再生成已签名的 AAB。**不要**将 keystore、密码或 `credentials.json` 提交到 GitHub。[3]

## 参考资料

[1]: https://docs.expo.dev/guides/local-app-development/ "Expo：Create a debug build locally"
[2]: https://docs.expo.dev/guides/local-app-development/ "Expo：Create a debug build locally"
[3]: https://docs.expo.dev/guides/local-app-production/ "Expo：Create a release build locally"
