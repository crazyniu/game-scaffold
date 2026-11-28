#!/bin/sh
# 构建完、签名前把一个文件或目录拷进 .app（CMakeLists 的 POST_BUILD 调用）：copy-into-app.sh <CMake 记的 .app> <源> <包内路径>
# 以 Xcode 的 $TARGET_BUILD_DIR/$WRAPPER_NAME 为准：归档（./package.sh 的 IPA）时 App 不在 CMake 记的
# build/ios/proj/Release-iphoneos/ 下，而在归档的临时目录里。原来直接拷到 CMake 的路径，归档里的 App 就缺了这些文件
# （fishsort 1.0.0（4）因为没带 GoogleService-Info.plist、Firebase 一启动就崩，被 App Store 拒，2026-11-27）
set -e
app="$1"; src="$2"; rel="$3"
if [ -n "$TARGET_BUILD_DIR" ] && [ -n "$WRAPPER_NAME" ]; then app="$TARGET_BUILD_DIR/$WRAPPER_NAME"; fi
mkdir -p "$app/$(dirname "$rel")"
rm -rf "$app/$rel"
cp -R "$src" "$app/$rel"
