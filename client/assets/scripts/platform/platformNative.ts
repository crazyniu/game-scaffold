// iOS / Android 原生实现（docs/04 第 5 节）：两端共用这一份，经 Cocos 的 jsbBridgeWrapper 和原生代码收发事件。
// 原生那头在 client/native/engine/ios/game/GameBridge.mm 和 client/native/engine/android/app/src/com/cocos/game/GameBridge.java，
// 两边实现同一组事件（下面 EV），参数和回复都是 JSON 字符串。
//
//   脚本 → 原生                         原生 → 脚本
//   game.init    {ads: 广告位}             game.ads      {ready: 广告能播了没有, off: 这一版没有广告（没配广告位、包里没有 SDK）}
//   game.rewarded {placement}              game.rewarded {result: done | skipped | unavailable}
//   game.interstitial {placement}          game.interstitial {shown: 播出来了没有}（关掉了，或者没播成）
//   game.banner  {show: true | false}
//   game.vibrate {kind}
//   game.share   {text}                    game.share    {ok}
//   game.privacy {}（打开隐私选项：欧洲等地的广告同意设置）
//   game.track   {name, params}（统计事件，记进 Firebase Analytics；包里没有 Firebase 时原生直接丢掉）
//   game.error   {message, stack}（脚本里没接住的错误，记进 Firebase Crashlytics；同上）
import { native, sys } from 'cc';
import { AdResult, Capability, PlatformBase, VibrateKind } from './platformBase';
import { adUnits, loadPlatformConfig, PlatformConfig } from './platformConfig';

const PREFIX = 'mygame.'; // 存档键前缀 = game.json 的 codeName + '.'（./run.sh check 会查两边一致）

const EV = {
  init: 'game.init',
  ads: 'game.ads',
  rewarded: 'game.rewarded',
  interstitial: 'game.interstitial',
  banner: 'game.banner',
  vibrate: 'game.vibrate',
  share: 'game.share',
  privacy: 'game.privacy',
  track: 'game.track',
  error: 'game.error',
} as const;

/** 一次启动最多报几个脚本错误：每帧都抛的错误不能把崩溃报告刷满（同一个错误只报一次） */
const ERROR_MAX = 20;

/** 等原生回复最多几秒：看一条激励视频连加载带播放不会超过这么久，超时按没看完算 */
const AD_TIMEOUT = 120;

export class PlatformNative extends PlatformBase {
  readonly id: string;
  private cfg: PlatformConfig | null = null;
  private ready = false;
  /** 原生说这一版没有广告（game.json 关了广告、包里没有广告 SDK） */
  private off = false;
  private waiting = new Map<string, (arg: string) => void>();
  private errorsSent = new Set<string>();

  constructor() {
    super();
    this.id = sys.os === sys.OS.IOS ? 'ios' : 'android';
  }

  /** 引擎给的系统语言：iOS 是 zh-Hant-TW 这种，Android 是 zh-TW / zh_TW_#Hant 这种 */
  override systemLanguage(): string {
    return String(sys.languageCode ?? '');
  }

  override async init(): Promise<void> {
    this.catchErrors();
    this.cfg = await loadPlatformConfig();
    if (this.cfg.languages?.app?.length) this.languages = this.cfg.languages.app;
    const bridge = native.jsbBridgeWrapper;
    bridge.addNativeEventListener(EV.ads, (arg: string) => {
      const r = parse(arg);
      const was = this.ready;
      this.ready = r.ready === true;
      if (r.off === true) this.off = true;
      if (was !== this.ready) this.onAdsChange();
    });
    for (const ev of [EV.rewarded, EV.interstitial, EV.share]) {
      bridge.addNativeEventListener(ev, (arg: string) => {
        const done = this.waiting.get(ev);
        this.waiting.delete(ev);
        done?.(arg);
      });
    }
    bridge.dispatchEventToNative(EV.init, JSON.stringify({ ads: adUnits(this.cfg, this.id) }));
  }

  /** 发一个事件，等同名的回复 */
  private ask(ev: string, payload: Record<string, unknown>, timeoutSec: number): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      // 同一种请求同时只有一个（广告一次只播一个）
      if (this.waiting.has(ev)) { resolve({}); return; }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.waiting.delete(ev);
        resolve({});
      }, timeoutSec * 1000);
      this.waiting.set(ev, (arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(parse(arg));
      });
      native.jsbBridgeWrapper.dispatchEventToNative(ev, JSON.stringify(payload));
    });
  }

  override adsAvailable(): boolean {
    return this.ready;
  }

  override async showRewarded(placement: string): Promise<AdResult> {
    if (!this.ready) return 'unavailable';
    const r = await this.ask(EV.rewarded, { placement }, AD_TIMEOUT);
    const result = r.result;
    return result === 'done' || result === 'skipped' ? result : 'unavailable';
  }

  override async showInterstitial(placement: string): Promise<boolean> {
    if (!this.ready) return false;
    const r = await this.ask(EV.interstitial, { placement }, AD_TIMEOUT);
    return r.shown === true;
  }

  override showBanner(_placement: string): void {
    if (this.ready) native.jsbBridgeWrapper.dispatchEventToNative(EV.banner, JSON.stringify({ show: true }));
  }

  override hideBanner(): void {
    native.jsbBridgeWrapper.dispatchEventToNative(EV.banner, JSON.stringify({ show: false }));
  }

  override async share(payload: Record<string, unknown>): Promise<boolean> {
    const name = this.cfg?.name.en ?? '';
    const r = await this.ask(EV.share, { text: String(payload.text ?? name) }, 300);
    return r.ok === true;
  }

  override vibrate(kind: VibrateKind): void {
    native.jsbBridgeWrapper.dispatchEventToNative(EV.vibrate, JSON.stringify({ kind }));
  }

  /** 统计事件：名字、参数按 Firebase Analytics 的规矩整理好再发（原生那头没有 Firebase 就丢掉） */
  override track(event: string, params: Record<string, unknown> = {}): void {
    const ev = analyticsEvent(event, params);
    if (ev) native.jsbBridgeWrapper.dispatchEventToNative(EV.track, JSON.stringify(ev));
  }

  /**
   * 脚本里没接住的错误（包括没人接的 Promise 失败）：引擎在原生那头抓到后调全局的 __errorHandler(文件, 行, 消息, 调用栈)，
   * 转给原生记进崩溃报告。同一个错误只报一次，一次启动最多报 ERROR_MAX 个
   */
  private catchErrors(): void {
    const g = globalThis as unknown as { __errorHandler?: (file: string, line: number, message: string, stack: string) => void };
    const previous = g.__errorHandler;
    g.__errorHandler = (file, line, message, stack) => {
      previous?.(file, line, message, stack);
      const msg = String(message ?? '').trim();
      const key = `${msg}|${String(stack ?? '').split('\n')[1] ?? ''}`;
      if (this.errorsSent.has(key) || this.errorsSent.size >= ERROR_MAX) return;
      this.errorsSent.add(key);
      native.jsbBridgeWrapper.dispatchEventToNative(EV.error, JSON.stringify({ message: msg.slice(0, 500), stack: String(stack ?? '').slice(0, 8000) }));
    };
  }

  override loadData(key: string): string {
    const v: unknown = sys.localStorage.getItem(PREFIX + key);
    return typeof v === 'string' ? v : '';
  }

  override saveData(key: string, value: string): void {
    sys.localStorage.setItem(PREFIX + key, value);
  }

  override hasCapability(cap: Capability): boolean {
    // 隐私选项是广告的同意设置，没有广告就不要
    if (cap === 'ads' || cap === 'privacy_options') return this.hasAds();
    // 隐私政策和有没有广告无关，一直要有（苹果 5.1.1、Google Play 用户数据政策）
    if (cap === 'privacy_policy') return !!this.cfg?.privacyPolicy;
    return cap === 'share' || cap === 'vibrate';
  }

  private hasAds(): boolean {
    return !this.off && this.cfg !== null && adUnits(this.cfg, this.id).rewarded !== '';
  }

  override openPrivacyOptions(): void {
    native.jsbBridgeWrapper.dispatchEventToNative(EV.privacy, '{}');
  }

  /** 用系统浏览器打开隐私政策网页 */
  override openPrivacyPolicy(): void {
    if (this.cfg?.privacyPolicy) sys.openURL(this.cfg.privacyPolicy);
  }
}

/**
 * Firebase Analytics 的规矩：事件名、参数名只能是字母数字下划线、字母开头、最长 40；不能用 firebase_ / google_ / ga_ 开头；
 * 一个事件最多 25 个参数；字符串值最长 100。参数值只留字符串、有限的数字、布尔。名字不合规矩的事件整个不发
 */
export function analyticsEvent(event: string, params: Record<string, unknown>): { name: string; params: Record<string, string | number | boolean> } | null {
  const ok = (n: string) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(n) && !/^(firebase_|google_|ga_)/.test(n);
  if (!ok(event)) return null;
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(params)) {
    if (n >= 25 || !ok(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 100);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else continue;
    n++;
  }
  return { name: event, params: out };
}

function parse(arg: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(arg || '{}');
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
