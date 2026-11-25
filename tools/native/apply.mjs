#!/usr/bin/env node
// 按仓库根目录的 game.json 改写各平台的构建配置和原生工程（docs/10-开发底座.md）。
// ./package.sh 选择微信或原生平台 打包前自动跑；改了 game.json 也可以单独跑：node tools/native/apply.mjs
// 只改下面列出的那几处，别的不动；重复跑结果一样。
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLIENT = join(ROOT, 'client');
const game = JSON.parse(readFileSync(join(ROOT, 'game.json'), 'utf8'));
const changed = [];

function write(path, text) {
  const old = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (old === text) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  changed.push(path.slice(ROOT.length + 1));
}

function remove(path) {
  if (!existsSync(path)) return;
  rmSync(path);
  changed.push(path.slice(ROOT.length + 1) + '（删掉）');
}

function edit(path, fn) {
  write(path, fn(readFileSync(path, 'utf8')));
}

const json = (v) => JSON.stringify(v, null, 2) + '\n';
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** 工程名：只留字母数字（Xcode / Gradle 工程名里有空格容易出问题） */
const projectName = game.name.en.replace(/[^A-Za-z0-9]/g, '') || game.codeName;
/**
 * 游戏里的语言代码 → iOS 的 .lproj、Android 的 values 目录（繁体给台湾和香港各一份）。
 * 英文是 iOS 的 Base 和 Android 的默认 values；要加语言先在这里加一行，再把代码写进 game.json 的 languages
 */
const LOCALES = {
  en: { ios: 'en', android: [] },
  zh_CN: { ios: 'zh-Hans', android: ['zh-rCN'] },
  zh_TW: { ios: 'zh-Hant', android: ['zh-rTW', 'zh-rHK'] },
  ja: { ios: 'ja', android: ['ja'] },
  ko: { ios: 'ko', android: ['ko'] },
  de: { ios: 'de', android: ['de'] },
  fr: { ios: 'fr', android: ['fr'] },
  es: { ios: 'es', android: ['es'] },
  pt: { ios: 'pt-BR', android: ['pt'] },
  it: { ios: 'it', android: ['it'] },
  ru: { ios: 'ru', android: ['ru'] },
  tr: { ios: 'tr', android: ['tr'] },
};
const appLangs = game.languages.app;
for (const l of appLangs) if (!LOCALES[l]) throw new Error(`game.json 的 languages.app 里有 ${l}，apply.mjs 的 LOCALES 里没有`);
/** 广告总开关（game.json 的 ads.enabled）：关掉时三端都没有广告，原生包里不带广告 SDK */
const adsOn = game.ads.enabled === true;
/**
 * 上架包（package.sh 的 iOS IPA、Android AAB，GAME_RELEASE=1）才用 AdMob 后台的真实广告位；其它包（Xcode 工程、模拟器、APK、
 * run.sh 试玩）用 game.json 的 ads.test 里 Google 官方的测试广告位：测试时点到真广告会被 AdMob 判成无效流量。
 * AdMob 应用 ID 一直用真的（UMP 的同意弹窗按它在后台的设置出）。微信的广告位只有一套（微信官方的流量主）
 */
const release = process.env.GAME_RELEASE === '1';
const units = (platform) => (release || !game.ads.test?.[platform] ? game.ads[platform] : game.ads.test[platform]);
if (adsOn) console.log(release ? '· 上架包：用 AdMob 的真实广告位' : '· 测试包：用 Google 的测试广告位（上架包才用真实的）');

/**
 * Firebase（统计 + 崩溃报告，game.json 的 firebase.enabled）：开着、并且仓库根目录的 firebase/ 里放了这个平台的配置文件
 * （Firebase 控制台下载的 google-services.json / GoogleService-Info.plist，不进仓库）才编进这个平台的包。
 * 开着却没放：测试包照样打、只是没有 Firebase；上架包（GAME_TARGET 是这个平台）停下，免得传上去的包没有统计
 */
const FIREBASE = {
  android: { file: join(ROOT, 'firebase/google-services.json'), to: join(CLIENT, 'native/engine/android/app/google-services.json') },
  ios: { file: join(ROOT, 'firebase/GoogleService-Info.plist'), to: join(CLIENT, 'native/engine/ios/GoogleService-Info.plist') },
};
const firebaseWanted = game.firebase?.enabled === true;
const target = process.env.GAME_TARGET ?? '';
function firebaseOn(platform) {
  if (!firebaseWanted) return false;
  const { file } = FIREBASE[platform];
  if (existsSync(file)) return true;
  const msg = `game.json 开了 firebase，但没有 ${file.slice(ROOT.length + 1)}（Firebase 控制台 → 项目设置 → 你的应用 → 下载配置文件，docs/10 第 5.1 节）`;
  if (release && target === platform) throw new Error(`${msg}：上架包不能没有统计，放好再打`);
  console.log(`! ${msg}，这次 ${platform} 不带 Firebase`);
  return false;
}
/** 配置文件里的包名要和 game.json 的一致：不一致时 Android 编译报错看不懂、iOS 静默收不到数据，这里先查 */
function checkFirebaseApp(platform) {
  const { file } = FIREBASE[platform];
  const text = readFileSync(file, 'utf8');
  if (platform === 'android') {
    const names = (JSON.parse(text).client ?? []).map((c) => c.client_info?.android_client_info?.package_name);
    if (!names.includes(game.android.packageName)) {
      throw new Error(`firebase/google-services.json 里没有 ${game.android.packageName} 这个应用（里面是 ${names.join('、') || '空的'}）：在 Firebase 控制台按 game.json 的 android.packageName 加 Android 应用，重新下载`);
    }
  } else {
    const id = /<key>BUNDLE_ID<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1];
    if (id !== game.ios.bundleId) {
      throw new Error(`firebase/GoogleService-Info.plist 是 ${id ?? '?'} 的，game.json 的 ios.bundleId 是 ${game.ios.bundleId}：在 Firebase 控制台按 bundleId 加 iOS 应用，重新下载`);
    }
  }
  return text;
}
/** 把配置文件拷到原生工程里（拷过去的也不进仓库）；这个平台不带 Firebase 时删掉拷过去的那份 */
function placeFirebase(platform, on) {
  const { to } = FIREBASE[platform];
  if (on) write(to, checkFirebaseApp(platform));
  else remove(to);
}

// 1. 游戏运行时读的平台配置（platform/platformConfig.ts）
write(
  join(CLIENT, 'assets/resources/config/platform.json'),
  json({
    name: game.name,
    version: game.version,
    languages: { app: game.languages.app, wechat: game.languages.wechat },
    adsEnabled: adsOn,
    // 设置里「隐私政策」打开的网页
    privacyPolicy: game.privacyPolicy ?? '',
    // 难度调试页（设置里的入口）开不开：测试包开着，上架前关掉
    levelLab: game.levelLab !== false,
    ads: { ios: units('ios'), android: units('android'), wechat: game.ads.wechat },
  }),
);

// 2. 各平台的 Cocos 构建配置
const buildConfig = (platform) => join(CLIENT, 'build-config', `${platform}.json`);
for (const platform of ['ios', 'android', 'wechatgame']) {
  const path = buildConfig(platform);
  if (!existsSync(path)) continue;
  edit(path, (s) => {
    const c = JSON.parse(s);
    c.packages = c.packages ?? {};
    if (platform === 'ios') {
      c.name = projectName;
      c.packages.ios = { ...c.packages.ios, packageName: game.ios.bundleId, developerTeam: game.ios.team ?? '', targetVersion: game.ios.minVersion };
    } else if (platform === 'android') {
      c.name = projectName;
      c.packages.android = { ...c.packages.android, packageName: game.android.packageName, apiLevel: game.android.targetSdk };
    } else {
      c.packages.wechatgame = { ...c.packages.wechatgame, appid: game.wechat.appid };
    }
    return json(c);
  });
}

// 3. iOS：Info.plist 的版本号、广告那几项（AdMob 应用 ID、跟踪授权说明、SKAdNetwork）；各语言的应用名；链不链广告 SDK
const ios = join(CLIENT, 'native/engine/ios');
if (existsSync(ios)) {
  const plistValue = (s, key, value) => s.replace(new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`), `$1${xml(value)}$2`);
  // 广告那几项：开着广告时放在 ITSAppUsesNonExemptEncryption 前面；关掉时整段去掉
  // （没有跟踪授权弹窗却写了 NSUserTrackingUsageDescription，审核会问）
  const AD_KEYS = /\t<key>GADApplicationIdentifier<\/key>[\s\S]*?<key>SKAdNetworkItems<\/key>\s*<array>[\s\S]*?<\/array>\n/;
  const adKeys = [
    '\t<key>GADApplicationIdentifier</key>',
    `\t<string>${xml(game.ios.admobAppId)}</string>`,
    '\t<key>NSUserTrackingUsageDescription</key>',
    `\t<string>${xml(game.ios.trackingText.en)}</string>`,
    '\t<key>SKAdNetworkItems</key>',
    '\t<array>',
    '\t\t<dict>',
    '\t\t\t<key>SKAdNetworkIdentifier</key>',
    '\t\t\t<string>cstr6suwn9.skadnetwork</string>',
    '\t\t</dict>',
    '\t</array>',
    '',
  ].join('\n');
  edit(join(ios, 'Info.plist'), (s) => {
    // 支持的语言：系统设成这些语言时，系统界面（应用名、权限弹窗）跟着用这种语言
    const locs = appLangs.map((l) => `\t\t<string>${LOCALES[l].ios}</string>`).join('\n');
    s = s.replace(/(<key>CFBundleLocalizations<\/key>\s*<array>)[\s\S]*?(\s*<\/array>)/, `$1\n${locs}$2`);
    s = plistValue(s, 'CFBundleDisplayName', game.name.en);
    s = plistValue(s, 'CFBundleShortVersionString', game.version);
    // iOS 的构建号可以单独加（game.json 的 ios.build：同一版本号重传 App Store Connect 要换构建号），没有就用全局的 build
    s = plistValue(s, 'CFBundleVersion', String(game.ios.build ?? game.build));
    s = s.replace(AD_KEYS, '');
    if (adsOn) s = s.replace('\t<key>ITSAppUsesNonExemptEncryption</key>', `${adKeys}\t<key>ITSAppUsesNonExemptEncryption</key>`);
    return s;
  });
  const strings = (lang) =>
    `/* 由 tools/native/apply.mjs 按 game.json 生成 */\n"CFBundleDisplayName" = "${game.name[lang]}";\n` +
    (adsOn ? `"NSUserTrackingUsageDescription" = "${game.ios.trackingText[lang]}";\n` : '');
  // 各语言的 InfoPlist.strings 由 CMakeLists 构建完拷进 .app（GAME_LPROJ 列目录；Cocos 的模板不带它们，不拷的话各语言的应用名进不了包）
  const lproj = ['Base', ...appLangs.map((l) => LOCALES[l].ios)].join(' ');
  // 工程名：Cocos 构建时也会这样改写，先写好免得每次构建都有改动；GAME_ADS：链不链广告 SDK；GAME_FIREBASE：链不链 Firebase
  const fbIos = firebaseOn('ios');
  placeFirebase('ios', fbIos);
  edit(join(ios, 'CMakeLists.txt'), (s) =>
    s
      .replace(/set\(APP_NAME "[^"]*"/, `set(APP_NAME "${projectName}"`)
      .replace(/set\(GAME_ADS (ON|OFF)\)/, `set(GAME_ADS ${adsOn ? 'ON' : 'OFF'})`)
      .replace(/set\(GAME_FIREBASE (ON|OFF)\)/, `set(GAME_FIREBASE ${fbIos ? 'ON' : 'OFF'})`)
      .replace(/set\(GAME_LPROJ [^)]*\)/, `set(GAME_LPROJ ${lproj})`),
  );
  write(join(ios, 'Base.lproj/InfoPlist.strings'), strings('en'));
  for (const l of appLangs) write(join(ios, `${LOCALES[l].ios}.lproj/InfoPlist.strings`), strings(l));
}

// 4. Android：版本号、AdMob 应用 ID、各语言的应用名；带不带广告 SDK（GAME_ADS）和广告 ID 权限；带不带 Firebase（GAME_FIREBASE）
const android = join(CLIENT, 'native/engine/android');
if (existsSync(android)) {
  const fbAndroid = firebaseOn('android');
  placeFirebase('android', fbAndroid);
  edit(join(android, 'app/build.gradle'), (s) =>
    s
      .replace(/versionCode \d+/, `versionCode ${game.build}`)
      .replace(/versionName "[^"]*"/, `versionName "${game.version}"`)
      .replace(/def GAME_ADS = (true|false)/, `def GAME_ADS = ${adsOn}`)
      .replace(/def GAME_FIREBASE = (true|false)/, `def GAME_FIREBASE = ${fbAndroid}`),
  );
  // 广告 ID 权限：关掉广告时显式去掉（tools:node="remove"），Play 后台的「广告 ID」声明就能选不用
  const AD_ID = /<uses-permission android:name="com\.google\.android\.gms\.permission\.AD_ID"[^>]*\/>/;
  edit(join(android, 'app/AndroidManifest.xml'), (s) =>
    s
      .replace(/(android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"\s*android:value=")[^"]*(")/, `$1${game.android.admobAppId}$2`)
      .replace(AD_ID, `<uses-permission android:name="com.google.android.gms.permission.AD_ID"${adsOn ? '' : ' tools:node="remove"'}/>`),
  );
  const label = (s, name) => s.replace(/(<string name="game_app_name">)[^<]*(<\/string>)/, `$1${xml(name)}$2`);
  edit(join(android, 'res/values/strings.xml'), (s) => label(s, game.name.en));
  const localeXml = (name) =>
    `<resources>\n    <!-- 这种系统语言下的应用名（tools/native/apply.mjs 按 game.json 生成） -->\n    <string name="game_app_name">${xml(name).replace(/'/g, "\\'")}</string>\n</resources>\n`;
  for (const l of appLangs) for (const q of LOCALES[l].android) write(join(android, `res/values-${q}/strings.xml`), localeXml(game.name[l]));
}

console.log(changed.length ? `✓ 按 game.json 改了：\n  ${changed.join('\n  ')}` : '✓ 各平台配置和 game.json 一致');
