#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source tools/cocos/creator.sh
if [ "$#" -gt 0 ]; then die "请运行 ./package.sh，然后输入菜单编号。"; fi

# 难度调试的各档关卡（约 20 MB）只给开发版用，打的包里不要（docs/10 第 9 节）：构建前挪出 assets，构建完挪回来。
# 构建前本来就清空导入缓存（cocos_build_once），挪走的文件不会残留在包里。中途被打断没挪回来的，下次运行开头先挪回来
LAB_DIR="$CLIENT/assets/resources/config/levels_lab"
LAB_STASH="$CLIENT/.levels_lab_stash"
lab_restore() {
  [ -d "$LAB_STASH" ] || return 0
  [ -e "$LAB_DIR" ] && die "${LAB_STASH} 和 ${LAB_DIR} 都在，手动看一下留哪个（levels_lab 在 git 里，可以 git checkout 恢复）"
  mv "$LAB_STASH/levels_lab" "$LAB_DIR"
  [ ! -f "$LAB_STASH/levels_lab.meta" ] || mv "$LAB_STASH/levels_lab.meta" "$LAB_DIR.meta"
  rmdir "$LAB_STASH"
}
lab_restore

cocos_build() {
  local platform="$1" code=0
  need_cocos
  if [ -d "$LAB_DIR" ]; then
    mkdir -p "$LAB_STASH"
    mv "$LAB_DIR" "$LAB_STASH/levels_lab"
    [ ! -f "$LAB_DIR.meta" ] || mv "$LAB_DIR.meta" "$LAB_STASH/levels_lab.meta"
    echo "· 难度调试的数据不进包（构建完挪回来）"
  fi
  cocos_build_once "$platform" || code=$?
  lab_restore
  [ "$code" -eq 36 ] || die "Cocos 构建 ${platform} 失败（退出码 ${code}）"
  if import_broken; then die 'Cocos 资源导入失败，请检查编辑器生成的 .meta 后重试。'; fi
  echo "构建完成：client/build/$platform"
}

# ---------------------------------------------------------------- 微信小游戏（docs/10 第 4 节）

# 构建 → resources 挪到网上并瘦身（tools/wechat/remote.mjs）→ 有 tcb（云开发命令行）就传到云开发的静态网站托管；NO_UPLOAD=1 只打包不传
wechat_build() {
  local env remote="client/build/wechatgame-remote/remote"
  node tools/native/apply.mjs
  cocos_build wechatgame
  node tools/wechat/remote.mjs
  [ -d "$remote" ] || return 0
  env="$(node -p "require('./game.json').wechat.cloudEnv || ''")"
  if [ "${NO_UPLOAD:-}" = 1 ]; then
    echo "· NO_UPLOAD=1：这次不上传，资源在 ${remote}"
  elif [ -n "$env" ] && command -v tcb >/dev/null 2>&1; then
    echo "· 上传资源到云开发环境 ${env} 的静态网站托管 …"
    tcb hosting deploy "$remote" remote -e "$env" || die "上传失败：先 tcb login，或在云开发控制台「静态网站托管」里手动上传 ${remote} 整个文件夹"
    echo "✓ 资源已上传（资源编号 $(cat client/build/wechatgame-remote/build-id.txt 2>/dev/null)，上传到微信时写进版本备注）"
    # 旧资源不自动清：线上版、审核版、体验版可能各用一批文件，只有人知道哪几个包还在用。
    # 要清时：node tools/wechat/prune.mjs <环境 ID> --keep <还在用的资源编号,...> [--yes]（docs/10 第 4 节）
    echo "· 网上的旧资源没有清；要清时按还在用的包手动清：node tools/wechat/prune.mjs ${env} --keep <资源编号,...>"
  else
    echo "! 还要把 ${remote} 整个文件夹传到静态网站托管的根目录（云开发控制台 → 静态网站托管 → 上传文件夹；装了 tcb 并 tcb login 过会自动传）"
  fi
  echo "微信开发者工具导入 client/build/wechatgame 即可预览、上传"
}

# ---------------------------------------------------------------- 原生包（docs/10-开发底座.md）

# iOS 的 Google Mobile Ads + UMP：下载到 client/native/engine/ios/sdk/（不进仓库），iOS 工程的 CMakeLists 链它。
# game.json 关了广告（ads.enabled 为 false）时不下载，CMakeLists 也不链。
# 上架包（ipa）开着广告却拿不到 SDK 就停下：原来下载失败照样往下打，传上去的包没有广告；测试包按没有广告编译
ios_sdk() {
  local mode="${1:-}" dir="$CLIENT/native/engine/ios/sdk" tmp fw
  if [ "$(node -p "require('./game.json').ads.enabled === true")" != true ]; then
    echo "· game.json 关了广告，这次不带广告 SDK"
    return 0
  fi
  if [ ! -d "$dir/GoogleMobileAds.xcframework" ] || [ ! -d "$dir/UserMessagingPlatform.xcframework" ]; then
    echo "· 下载 Google Mobile Ads iOS SDK …"
    tmp="$(mktemp -d)"
    if curl -fsSL -o "$tmp/sdk.zip" https://dl.google.com/googleadmobadssdk/googlemobileadssdkios.zip && (cd "$tmp" && unzip -q sdk.zip); then
      mkdir -p "$dir"
      find "$tmp" -maxdepth 3 -name '*.xcframework' -type d -exec cp -R {} "$dir/" \;
    fi
    rm -rf "$tmp"
  fi
  for fw in GoogleMobileAds UserMessagingPlatform; do
    [ -d "$dir/$fw.xcframework" ] && continue
    [ "$mode" = ipa ] && die "广告 SDK 没下载下来（缺 ${fw}.xcframework）：上架包不能没有广告，检查网络后重试，或手动解压到 ${dir}/"
    echo "! 缺 ${fw}.xcframework（SDK 下载失败），这次按没有广告编译（测试包）"
    return 0
  done
  ls "$dir"
}

# iOS 的 Firebase（Analytics + Crashlytics）：game.json 开了 firebase、并且放了 firebase/GoogleService-Info.plist 时，
# 下载官方的 Firebase.zip（约 400 MB，只下一次），把要用的那几个 xcframework 拷到 client/native/engine/ios/sdk/firebase/（不进仓库）。
# 版本固定在 FIREBASE_IOS_VERSION，升级时改这里、删掉 sdk/firebase/ 重下。上架包拿不到就停下，测试包按没有 Firebase 编译
FIREBASE_IOS_VERSION=13.2.0
ios_firebase_sdk() {
  local mode="${1:-}" dir="$CLIENT/native/engine/ios/sdk/firebase" tmp sub
  [ -f "$CLIENT/native/engine/ios/GoogleService-Info.plist" ] || return 0
  if [ ! -f "$dir/.version" ] || [ "$(cat "$dir/.version")" != "$FIREBASE_IOS_VERSION" ]; then
    echo "· 下载 Firebase iOS SDK ${FIREBASE_IOS_VERSION}（约 400 MB）…"
    tmp="$(mktemp -d)"
    if curl -fL --progress-bar -o "$tmp/firebase.zip" "https://github.com/firebase/firebase-ios-sdk/releases/download/${FIREBASE_IOS_VERSION}/Firebase.zip" \
      && (cd "$tmp" && unzip -q firebase.zip 'Firebase/FirebaseAnalytics/*' 'Firebase/FirebaseCrashlytics/*'); then
      rm -rf "$dir"; mkdir -p "$dir"
      # 拷的时候保留符号链接（Firebase 的说明：不然签名会坏）
      for sub in FirebaseAnalytics FirebaseCrashlytics; do
        (cd "$tmp/Firebase/$sub" && cp -RP ./* "$dir/")
      done
      echo "$FIREBASE_IOS_VERSION" > "$dir/.version"
    fi
    rm -rf "$tmp"
  fi
  if [ ! -d "$dir/FirebaseCore.xcframework" ] || [ ! -x "$dir/upload-symbols" ]; then
    [ "$mode" = ipa ] && die "Firebase SDK 没下载下来：上架包不能没有统计，检查网络后重试"
    echo "! Firebase SDK 没下载下来，这次按没有 Firebase 编译（测试包）"
  fi
  return 0
}

# Cocos 3.8.8 预编译的 libwebp.a 和 Xcode 27 的链接器不兼容（成员没对齐），用 libtool 重新打包一份对齐的（iOS 工程的 CMakeLists 用它）
ios_fix_webp() {
  local src dst="$CLIENT/native/engine/ios/sdk/libwebp/libwebp.a"
  src="$(dirname "$(dirname "$COCOS")")/Resources/resources/3d/engine/native/external/ios/libs/libwebp.a"
  [ -f "$dst" ] && [ "$dst" -nt "$src" ] && return 0
  [ -f "$src" ] || { echo "! 没找到 ${src}，跳过"; return 0; }
  mkdir -p "$(dirname "$dst")"
  xcrun libtool -static -o "$dst" "$src" 2>/dev/null || { echo "! libwebp 重新打包失败"; rm -f "$dst"; }
}

# xcode 工程和 scheme：Cocos 按构建配置的 name 起名（name-mobile）
ios_project() {
  local proj
  proj="$(ls -d "$CLIENT"/build/ios/proj/*.xcodeproj 2>/dev/null | head -1)"
  [ -n "$proj" ] || die "没找到 Xcode 工程（client/build/ios/proj/*.xcodeproj），请先在打包菜单中导出 Xcode 工程"
  echo "$proj"
}

ios_build() {
  local mode="${1:-}" proj scheme team
  # 只有 IPA（传 App Store）用真实广告位，其它产物用 Google 的测试广告位（tools/native/apply.mjs）
  GAME_RELEASE="$([ "$mode" = ipa ] && echo 1 || echo 0)" GAME_TARGET=ios node tools/native/apply.mjs || die "按 game.json 改写原生工程失败"
  ios_sdk "$mode"
  ios_firebase_sdk "$mode"
  ios_fix_webp
  # Preserve the working tree's launch artwork while Creator exports its templates.
  (
    ios_dir="$CLIENT/native/engine/ios"
    saved_launch="$(mktemp -d)"
    for image in "$ios_dir"/LaunchScreenBackground*.png; do
      [ ! -f "$image" ] || cp -p "$image" "$saved_launch/"
    done
    restore_launch() {
      for image in "$saved_launch"/*.png; do
        [ ! -f "$image" ] || cp -p "$image" "$ios_dir/"
      done
      rm -rf "$saved_launch"
    }
    trap restore_launch EXIT
    cocos_build ios
  )
  proj="$(ios_project)"
  scheme="$(basename "$proj" .xcodeproj)-mobile"
  team="$(node -e 'console.log(require("./game.json").ios.team || "")')"
  case "$mode" in
    "") echo "✓ Xcode 工程：${proj}（用 Xcode 打开可以直接装到手机上调试）" ;;
    sim)
      # 只编 arm64（Apple 芯片的 Mac）：Cocos 预编译库的 x86_64 模拟器部分和 Xcode 27 的链接器不兼容
      xcodebuild -project "$proj" -scheme "$scheme" -sdk iphonesimulator -configuration Debug ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
        -derivedDataPath "$CLIENT/build/ios/derived" CODE_SIGNING_ALLOWED=NO build > "$CLIENT/build/ios/sim.log" 2>&1 \
        || { grep -E "error:|BUILD FAILED" "$CLIENT/build/ios/sim.log" | head -30; die "模拟器版编译失败（全文 client/build/ios/sim.log）"; }
      # Cocos 生成的工程在模拟器上排除了 arm64（EXCLUDED_ARCHS，引擎的预编译库没有 arm64 模拟器切片），只编 arm64 时 xcodebuild
      # 什么都不编也报成功。没编出可执行文件就照实说，别当编译通过
      local simapp
      simapp="$(ls -td "$CLIENT"/build/ios/proj/Debug-iphonesimulator/*.app "$CLIENT"/build/ios/derived/Build/Products/Debug-iphonesimulator/*.app 2>/dev/null | head -1 || true)"
      [ -n "$simapp" ] && [ -f "$simapp/$(basename "$simapp" .app)" ] \
        || die "模拟器版没有编出可执行文件（Cocos 的工程在模拟器上排除了 arm64），这台 Mac 上模拟器版用不了；查编译用「3 未签名真机 App」"
      echo "✓ 模拟器版编译通过：${simapp}"
      ;;
    dev)
      xcodebuild -project "$proj" -scheme "$scheme" -sdk iphoneos -configuration Release \
        -derivedDataPath "$CLIENT/build/ios/derived-dev" CODE_SIGNING_ALLOWED=NO build > "$CLIENT/build/ios/dev.log" 2>&1 \
        || { grep -E "error:|BUILD FAILED" "$CLIENT/build/ios/dev.log" | sort -u | head -30; die "真机版编译失败（全文 client/build/ios/dev.log）"; }
      echo "✓ 真机版（Release、不签名）编译通过"
      ;;
    phone)
      # 签名后装到和这台 Mac 配对的 iPhone 上（USB 或同一网络都行），装完启动；广告用 Google 的测试广告位
      [ -n "$team" ] || die "game.json 的 ios.team 还没填（Apple 开发者账号的 Team ID）"
      local log="$CLIENT/build/ios/phone.log" app udid
      xcodebuild -project "$proj" -scheme "$scheme" -sdk iphoneos -configuration Release \
        -derivedDataPath "$CLIENT/build/ios/derived-phone" DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic \
        -allowProvisioningUpdates build > "$log" 2>&1 \
        || { grep -E "error:|BUILD FAILED" "$log" | sort -u | head -30; die "签名版编译失败（全文 client/build/ios/phone.log）"; }
      # Cocos 生成的工程把产物放在 proj/Release-iphoneos/（不在 derivedData 里）；两处都找，取最新的
      app="$(ls -td "$CLIENT"/build/ios/proj/Release-iphoneos/*.app "$CLIENT"/build/ios/derived-phone/Build/Products/Release-iphoneos/*.app 2>/dev/null | head -1 || true)"
      [ -n "$app" ] || die "编译通过了，但没找到打好的 App（client/build/ios/proj/Release-iphoneos/）"
      codesign -dv "$app" 2>&1 | grep "TeamIdentifier=$team" >/dev/null || die "${app} 没有用 ${team} 签名（全文 client/build/ios/phone.log）"
      # 配对过、现在连得上的 iPhone（第一部）
      xcrun devicectl list devices --json-output "$CLIENT/build/ios/devices.json" >/dev/null 2>&1 || true
      udid="$(node -e '
        const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).result.devices;
        const ok = d.filter((x) => x.hardwareProperties?.deviceType === "iPhone" && x.connectionProperties?.pairingState === "paired" && x.connectionProperties?.tunnelState !== "unavailable");
        console.log(ok[0]?.hardwareProperties?.udid ?? "");
      ' "$CLIENT/build/ios/devices.json" 2>/dev/null)"
      [ -n "$udid" ] || die "没找到连着的 iPhone（手机解锁、和这台 Mac 在同一网络或插上线；第一次要在 Xcode → Devices 里配对，手机上打开「开发者模式」）。App 在 ${app}"
      xcrun devicectl device install app --device "$udid" "$app" >> "$log" 2>&1 || { tail -15 "$log"; die "装到手机失败"; }
      xcrun devicectl device process launch --device "$udid" "$(node -p 'require("./game.json").ios.bundleId')" >> "$log" 2>&1 \
        && echo "✓ 已装到手机并打开（测试广告位）" || echo "✓ 已装到手机（没能自动打开：手机锁着的话解锁后点图标）"
      ;;
    ipa)
      [ -n "$team" ] || die "game.json 的 ios.team 还没填（Apple 开发者账号的 Team ID）"
      local out="$CLIENT/build/ios/release"
      rm -rf "$out"; mkdir -p "$out"
      xcodebuild -project "$proj" -scheme "$scheme" -sdk iphoneos -configuration Release \
        -archivePath "$out/app.xcarchive" DEVELOPMENT_TEAM="$team" -allowProvisioningUpdates archive > "$out/archive.log" 2>&1 \
        || { grep -E "error:|ARCHIVE FAILED" "$out/archive.log" | head -30; die "归档失败（全文 client/build/ios/release/archive.log）"; }
      ios_check_archive "$out/app.xcarchive"
      cat > "$out/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>${team}</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
PLIST
      xcodebuild -exportArchive -archivePath "$out/app.xcarchive" -exportPath "$out" \
        -exportOptionsPlist "$out/ExportOptions.plist" -allowProvisioningUpdates > "$out/export.log" 2>&1 \
        || { tail -20 "$out/export.log"; die "导出 ipa 失败"; }
      ios_upload_dsyms "$out/app.xcarchive"
      echo "✓ ipa：$(ls "$out"/*.ipa)（菜单「6 上传 App Store Connect」直接传，或用 Transporter 上传）"
      ;;
    *) die "未知的 iOS 产物" ;;
  esac
}

# 带 Firebase 的上架包：把归档里的 dSYM 传给 Crashlytics，崩溃堆栈才看得懂（传失败不挡上架，提示手动补传）
ios_upload_dsyms() {
  local archive="$1" tool="$CLIENT/native/engine/ios/sdk/firebase/upload-symbols" plist="$CLIENT/native/engine/ios/GoogleService-Info.plist"
  [ -f "$plist" ] && [ -x "$tool" ] || return 0
  if [ ! -d "$archive/dSYMs" ] || [ -z "$(ls "$archive/dSYMs")" ]; then
    echo "! 归档里没有 dSYM，Crashlytics 的崩溃堆栈会看不懂"
    return 0
  fi
  echo "· 把 dSYM 传给 Crashlytics …"
  "$tool" -gsp "$plist" -p ios "$archive/dSYMs" > "$CLIENT/build/ios/release/dsym.log" 2>&1 \
    && echo "✓ dSYM 已传给 Crashlytics" \
    || echo "! dSYM 没传上（全文 client/build/ios/release/dsym.log）；之后补传：${tool} -gsp ${plist} -p ios ${archive}/dSYMs"
}

# 归档里的 App 要带齐构建完才拷进去的文件（CMakeLists 的 game_copy_into_app）。原来这些文件只拷到了普通构建的目录，
# 归档里没有，装手机测不出来（fishsort 1.0.0（4）缺 GoogleService-Info.plist、Firebase 一启动就崩，被 App Store 拒，2026-11-27）
ios_check_archive() {
  local app f missing=""
  app="$(ls -d "$1"/Products/Applications/*.app 2>/dev/null | head -1)"
  [ -n "$app" ] || die "归档里没找到 App（$1/Products/Applications/）"
  for f in PrivacyInfo.xcprivacy en.lproj/InfoPlist.strings; do
    [ -e "$app/$f" ] || missing="$missing $f"
  done
  if [ -d "$CLIENT/native/engine/ios/sdk/firebase/FirebaseAnalytics.xcframework" ] && [ -f "$CLIENT/native/engine/ios/GoogleService-Info.plist" ]; then
    [ -e "$app/GoogleService-Info.plist" ] || missing="$missing GoogleService-Info.plist"
  fi
  [ -z "$missing" ] || die "归档里的 App 缺这些文件：${missing}（CMakeLists 的 game_copy_into_app 没拷进去），这样的包传上去会被拒"
  echo "✓ 归档里的 App 带齐了隐私清单、各语言应用名$([ -e "$app/GoogleService-Info.plist" ] && echo '、Firebase 配置')"
}

# 把上一次「4 IPA」打好的归档传到 App Store Connect：用 Xcode 里登录的开发者账号（Xcode → Settings → Accounts），不另要密码。
# 传完 15–30 分钟后在 App Store Connect 里出现这个构建号
ios_upload() {
  local out="$CLIENT/build/ios/release" team
  [ -d "$out/app.xcarchive" ] || die "没有打好的归档（client/build/ios/release/app.xcarchive），先选「4 IPA」"
  team="$(node -e 'console.log(require("./game.json").ios.team || "")')"
  [ -n "$team" ] || die "game.json 的 ios.team 还没填"
  cat > "$out/UploadOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${team}</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
PLIST
  echo "· 上传到 App Store Connect（构建号 $(/usr/libexec/PlistBuddy -c 'Print ApplicationProperties:CFBundleVersion' "$out/app.xcarchive/Info.plist")）…"
  xcodebuild -exportArchive -archivePath "$out/app.xcarchive" -exportPath "$out/upload" \
    -exportOptionsPlist "$out/UploadOptions.plist" -allowProvisioningUpdates > "$out/upload.log" 2>&1 \
    || { grep -iE "error|fail" "$out/upload.log" | sort -u | head -15; die "上传失败（全文 client/build/ios/release/upload.log）"; }
  echo "✓ 已上传到 App Store Connect，处理完（15–30 分钟）在 App 的「构建版本」里能选到"
}

# Google Play 的上传密钥（docs/10 第 4 节）：签名配置写在 ~/.gradle/gradle.properties（不进仓库）。
# 第一次打 AAB 时没有就在这里生成：密码由用户自己输入，密钥文件放在仓库外面，提醒备份（丢了要找 Google 重置）
GRADLE_PROPS="$HOME/.gradle/gradle.properties"
find_keytool() {
  local k
  for k in "$(command -v keytool 2>/dev/null)" "${JAVA_HOME:-}/bin/keytool" \
           "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
           "$(/usr/libexec/java_home 2>/dev/null)/bin/keytool"; do
    if [ -n "$k" ] && [ -x "$k" ] && "$k" -help >/dev/null 2>&1; then echo "$k"; return; fi
  done
}
android_upload_key() {
  local store pw pw2 kt
  store="$(grep -E '^RELEASE_STORE_FILE=' "$GRADLE_PROPS" 2>/dev/null | tail -1 | cut -d= -f2-)"
  if [ -n "$store" ]; then
    [ -f "$store" ] || die "~/.gradle/gradle.properties 里的上传密钥 ${store} 不存在（换了电脑？从备份拷回来）"
    echo "· 上传密钥：${store}"
    return 0
  fi
  kt="$(find_keytool)"
  [ -n "$kt" ] || die "没找到 keytool（装 Android Studio 或 JDK）"
  echo "还没有 Google Play 的上传密钥，现在生成一个（只做一次）。"
  echo "密码只有你知道；密钥文件和密码都要备份好，丢了就不能更新游戏，要找 Google 重置。"
  printf '密钥文件放哪（回车 = %s）：' "$HOME/keys/$(node -p "require('./game.json').codeName")-upload.jks"
  IFS= read -r store || exit 1
  store="${store:-$HOME/keys/$(node -p "require('./game.json').codeName")-upload.jks}"
  [ ! -e "$store" ] || die "${store} 已经存在：要用它就手动把四个 RELEASE_ 变量写进 ~/.gradle/gradle.properties（docs/10 第 4 节）"
  while :; do
    printf '设一个密码（至少 6 位，输入时不显示）：'; IFS= read -rs pw || exit 1; echo
    printf '再输一遍：'; IFS= read -rs pw2 || exit 1; echo
    [ "${#pw}" -ge 6 ] && [ "$pw" = "$pw2" ] && break
    echo "两次不一样或不到 6 位，重来。"
  done
  mkdir -p "$(dirname "$store")"
  "$kt" -genkeypair -keystore "$store" -alias upload -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$pw" -keypass "$pw" -dname "CN=$(node -p 'require("./game.json").name.en || "Game"' 2>/dev/null)" >/dev/null 2>&1 \
    || die "生成上传密钥失败"
  mkdir -p "$(dirname "$GRADLE_PROPS")"
  {
    echo ""
    echo "# Google Play 上传密钥（./package.sh 生成于 $(date +%F)）"
    echo "RELEASE_STORE_FILE=$store"
    echo "RELEASE_STORE_PASSWORD=$pw"
    echo "RELEASE_KEY_ALIAS=upload"
    echo "RELEASE_KEY_PASSWORD=$pw"
  } >> "$GRADLE_PROPS"
  chmod 600 "$GRADLE_PROPS" "$store"
  echo "✓ 上传密钥：${store}（签名配置写进了 ~/.gradle/gradle.properties）——现在就把这个文件和密码备份到别处"
}

# 16 KB 内存页（Google Play 要求，targetSdk 35 起）：AAB 里每个 .so 的 LOAD 段要按 16 KB（0x4000）对齐。
# 查不了（没有 readelf、解不开、一个 arm64 原生库都没有）或者没对齐都算失败：原来这几种都打印通过、照样出包。
# APK 的 ZIP 对齐由 Google Play 从 AAB 生成 APK 时负责，不在这里查；传上去以后 Play Console 的 App Bundle 浏览器里还会再查一遍
android_check_16k() {
  local aab="$1" ndk="$2" tmp readelf so hdr aligns bad=0 n=0
  readelf="$(ls -d "$ndk"/toolchains/llvm/prebuilt/*/bin/llvm-readelf 2>/dev/null | head -1)"
  [ -x "$readelf" ] || { echo "✗ 没找到 llvm-readelf（${ndk}），查不了 16 KB 页"; return 1; }
  tmp="$(mktemp -d)"
  if ! unzip -q -o "$aab" 'base/lib/*' -d "$tmp"; then
    rm -rf "$tmp"; echo "✗ 解不开 ${aab} 里的原生库，查不了 16 KB 页"; return 1
  fi
  for so in "$tmp"/base/lib/arm64-v8a/*.so; do
    [ -f "$so" ] || continue
    n=$((n + 1))
    # 先把 readelf 的结果拿出来再判断：原来直接接管道，readelf 读失败时输出是空的，grep 什么都不匹配就当成对齐了
    if ! hdr="$("$readelf" -lW "$so" 2>&1)"; then
      echo "✗ $(basename "$so")：readelf 读不了（${hdr%%$'\n'*}）"; bad=1; continue
    fi
    aligns="$(printf '%s\n' "$hdr" | awk '$1=="LOAD"{print $NF}')"
    if [ -z "$aligns" ]; then
      echo "✗ $(basename "$so")：没有 LOAD 段，查不了对齐"; bad=1
    elif printf '%s\n' "$aligns" | grep -qvE '^0x(4000|8000|10000)$'; then
      echo "✗ $(basename "$so") 没有按 16 KB 对齐（$(printf '%s' "$aligns" | sort -u | tr '\n' ' ')）"; bad=1
    fi
  done
  rm -rf "$tmp"
  [ "$n" -gt 0 ] || { echo "✗ AAB 里没有 arm64-v8a 的原生库，查不了 16 KB 页"; return 1; }
  [ "$bad" = 0 ] || { echo "✗ 16 KB 内存页检查没过（上面几个原生库），Google Play 会拒（docs/06）"; return 1; }
  echo "✓ 16 KB 内存页：arm64 的 ${n} 个原生库都按 16 KB 对齐"
}

android_build() {
  local mode="${1:-apk}" proj
  # 只有 AAB（传 Google Play）用真实广告位，其它产物用 Google 的测试广告位（tools/native/apply.mjs）
  [ "$mode" != aab ] || android_upload_key
  GAME_RELEASE="$([ "$mode" = aab ] && echo 1 || echo 0)" GAME_TARGET=android node tools/native/apply.mjs || die "按 game.json 改写原生工程失败"
  local sdk ndk cfg cand
  # SDK：ANDROID_HOME，或者 Android Studio 的默认位置，或者外接盘上的 /Volumes/*/Android/sdk（Mac 上的 SDK 装在外接盘 /Volumes/Lexar/Android/sdk）
  sdk="${ANDROID_HOME:-}"
  if [ -z "$sdk" ]; then
    for cand in "$HOME/Library/Android/sdk" /Volumes/*/Android/sdk; do
      if [ -d "$cand/platforms" ] && [ -d "$cand/ndk" ]; then sdk="$cand"; break; fi
    done
  fi
  [ -n "$sdk" ] && [ -d "$sdk/platforms" ] || die "没找到 Android SDK（装 Android Studio，或设 ANDROID_HOME；也会找外接盘上的 /Volumes/*/Android/sdk）"
  # NDK：ANDROID_NDK_HOME，或者 SDK 里 ndk/ 下版本最新的那个（版本号都是两位数起，按字面排序就行）
  ndk="${ANDROID_NDK_HOME:-$(ls -d "$sdk"/ndk/*/ 2>/dev/null | sort | tail -1)}"
  ndk="${ndk%/}"
  [ -d "$ndk" ] || die "没找到 Android NDK（Android Studio → SDK Manager → SDK Tools 装 NDK，或设 ANDROID_NDK_HOME）"
  echo "· Android SDK：$sdk"
  echo "· Android NDK：$ndk"
  # SDK、NDK 路径不用去 Cocos 偏好设置里填：带进这次的构建参数（sdkPath、ndkPath，Cocos 3.8 命令行构建支持），文件不进仓库
  cfg="$CLIENT/build-config/.android.local.json"
  SDK="$sdk" NDK="$ndk" node -e '
    const fs = require("fs");
    const [src, dst] = process.argv.slice(1);
    const c = JSON.parse(fs.readFileSync(src, "utf8"));
    c.packages.android = { ...c.packages.android, sdkPath: process.env.SDK, ndkPath: process.env.NDK };
    fs.writeFileSync(dst, JSON.stringify(c, null, 2) + "\n");
  ' "$CLIENT/build-config/android.json" "$cfg"
  NDK_ROOT="$ndk" ANDROID_SDK_ROOT="$sdk" ANDROID_HOME="$sdk" COCOS_BUILD_CONFIG="$cfg" cocos_build android
  proj="$CLIENT/build/android/proj"
  [ -x "$proj/gradlew" ] || die "没找到 Gradle 工程：$proj"
  # 最低 Android 版本按 game.json 的 android.minSdk 写进 Gradle 工程（Cocos 生成的不跟它走； 在 Mac 上打 AAB 时补的）；再打开优化型资源缩减
  node -e '
    const fs = require("node:fs");
    const props = process.argv[1];
    const minSdk = require("./game.json").android.minSdk;
    const content = fs.readFileSync(props, "utf8");
    let out = content.replace(/^PROP_MIN_SDK_VERSION=.*$/m, `PROP_MIN_SDK_VERSION=${minSdk}`);
    // 优化型资源缩减（R8 连同代码一起判断哪些资源用不到；Android Gradle 插件 9 起默认打开）：
    // Play 管理中心「请使用 R8 优化」的一项（docs/06 第 4 节）。Cocos 生成的工程没有，这里补上；AGP 8.10 认的名字是 android.r8.optimizedShrinking
    if (!/^android\.r8\.optimizedShrinking=/m.test(out)) out = out.trimEnd() + "\nandroid.r8.optimizedShrinking=true\n";
    fs.writeFileSync(props, out);
  ' "$proj/gradle.properties"
  case "$mode" in
    project) echo "Gradle 工程：$proj" ;;
    apk) (cd "$proj" && ./gradlew assembleDebug) && echo "✓ apk：$(find "$proj" -name '*.apk' -path '*debug*' | head -1)" ;;
    aab)
      # 签名：RELEASE_STORE_FILE 等四个变量写在 ~/.gradle/gradle.properties（不进仓库，docs/10）
      local aab
      (cd "$proj" && ./gradlew bundleRelease) || die "AAB 编译失败"
      aab="$(find "$proj" -path '*/outputs/bundle/release/*.aab' | head -1)"
      [ -n "$aab" ] || die "没找到打好的 AAB"
      "$(find_keytool)" -printcert -rfc -jarfile "$aab" 2>/dev/null | grep -q -- '-----BEGIN CERTIFICATE-----' || die "${aab} 没有签名（检查 ~/.gradle/gradle.properties 的 RELEASE_ 变量）"
      android_check_16k "$aab" "$ndk" || die "16 KB 内存页检查没过，这个 AAB 不要传（${aab}）"
      # R8 不能整包保留第三方库（Play 管理中心会提示「请使用 R8 优化」，docs/06 第 4 节）：查合并后的规则
      local r8cfg broad
      r8cfg="$(find "$proj/build" -path '*/outputs/mapping/release/configuration.txt' | head -1)"
      [ -n "$r8cfg" ] || die "没找到 R8 合并后的规则（outputs/mapping/release/configuration.txt）"
      broad="$(grep -E '^-keep[a-z,]* (public )?class (com\.google|com\.android|androidx|google\.[a-z]+)\.\*\* *\{' "$r8cfg" || true)"
      [ -z "$broad" ] || die "R8 规则里还有整包保留，这个 AAB 不要传：${broad}"
      echo "✓ R8：没有整包保留 Google / androidx 库的规则"
      # 带 Firebase 时：把引擎带符号的 .so 传给 Crashlytics（C++ 崩溃堆栈才看得懂；Java 的混淆表 bundleRelease 已经自动传了）
      if grep -q '^def GAME_FIREBASE = true' "$CLIENT/native/engine/android/app/build.gradle"; then
        (cd "$proj" && ./gradlew uploadCrashlyticsSymbolFileRelease) \
          || echo "! 引擎符号没传给 Crashlytics（不挡上架）；之后在 ${proj} 里补传：./gradlew uploadCrashlyticsSymbolFileRelease"
      fi
      echo "✓ aab：${aab}（已用上传密钥签名、真实广告位；传到 Google Play Console）" ;;
    *) die "未知的 Android 产物" ;;
  esac
}
# A successful choice builds exactly once; returning from a submenu runs nothing.
read_choice() {
  printf '请输入编号：'
  IFS= read -r choice || exit 0
}

while :; do
  printf '%s\n' '打包平台' '1 微信小游戏' '2 iOS' '3 Android' '4 网页版' '0 退出'
  read_choice
  case "$choice" in
    1) wechat_build; break ;;
    2)
      while :; do
        printf '%s\n' 'iOS 产物' '1 Xcode 工程' '2 模拟器 App' '3 未签名真机 App' '4 IPA' '5 装到手机' '6 上传 App Store Connect（上一次的 IPA）' '0 返回'
        read_choice
        case "$choice" in
          1) ios_build; exit ;;
          2) ios_build sim; exit ;;
          3) ios_build dev; exit ;;
          4) ios_build ipa; exit ;;
          5) ios_build phone; exit ;;
          6) ios_upload; exit ;;
          0) break ;;
          *) echo '请输入 0 至 6。' ;;
        esac
      done ;;
    3)
      while :; do
        printf '%s\n' 'Android 产物' '1 APK' '2 AAB' '3 Gradle 工程' '0 返回'
        read_choice
        case "$choice" in
          1) android_build apk; exit ;;
          2) android_build aab; exit ;;
          3) android_build project; exit ;;
          0) break ;;
          *) echo '请输入 0 至 3。' ;;
        esac
      done ;;
    4) cocos_build web-mobile; break ;;
    0) exit 0 ;;
    *) echo '请输入 0 至 4。' ;;
  esac
done
