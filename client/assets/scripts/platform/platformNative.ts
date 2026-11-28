// iOS / Android 原生实现（docs/04 第 5 节）：两端共用这一份，经 Cocos 的 jsbBridgeWrapper 和原生代码收发事件。
// 原生那头在 client/native/engine/ios/game/GameBridge.mm 和 client/native/engine/android/app/src/com/cocos/game/GameBridge.java，
// 两边实现同一组事件（下面 EV），参数和回复都是 JSON 字符串。
//
//   脚本 → 原生                         原生 → 脚本
//   game.init    {ads: 广告位}             game.ads      {ready: 激励视频能播了没有, started: 广告 SDK 起来了（插屏、横幅能请求）, off: 这一版没有广告（没配广告位、包里没有 SDK）,
//                                                         consent: false = 用户没同意（或改成不同意），请求不了广告}
//                                          game.consent  {privacy: 要不要「隐私选项」入口（UMP 说需要才给，欧洲等地）}
//                                          game.adfail   {format: rewarded | interstitial | consent | consent_form, code: 错误码, msg}（拉广告失败，记埋点 ad_load_fail）
//   game.rewarded {placement}              game.rewarded {result: done | skipped | unavailable}
//   game.interstitial {placement}          game.interstitial {shown: 播出来了没有}（关掉了，或者没播成）
//   game.banner  {show: true | false}
//   game.vibrate {kind}
//   game.share   {text}                    game.share    {ok}
//   game.privacy {}（打开隐私选项：欧洲等地的广告同意设置）  game.privacy {ok: 表单打开了没有}（脚本这边不等它）
//   game.track   {name, params}（统计事件，记进 Firebase Analytics；包里没有 Firebase 时原生直接丢掉）
//   game.error   {message, stack}（脚本里没接住的错误，记进 Firebase Crashlytics；同上）
import { native, sys } from 'cc';
import { AdResult, Capability, PlatformBase, VibrateKind } from './platformBase';
import { adUnits, loadPlatformConfig, PlatformConfig } from './platformConfig';

const PREFIX = 'mygame.'; // 存档键前缀 = game.json 的 codeName + '.'（./run.sh check 会查两边一致）

const EV = {
  init: 'game.init',
  ads: 'game.ads',
  adfail: 'game.adfail',
  consent: 'game.consent',
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
/**
 * 插屏等多久：原生没加载好时马上回「没播」；播出来以后丢了关闭回调，转场最多等这么久就照常往下走
 * （和激励视频一样等 120 秒的话，结算后会卡两分钟）。插屏真的还在播也没关系：它盖在游戏上面
 */
const INTERSTITIAL_TIMEOUT = 45;

export class PlatformNative extends PlatformBase {
  readonly id: string;
  private cfg: PlatformConfig | null = null;
  /** 激励视频现在能播 */
  private ready = false;
  /** 这次启动里广告 SDK 起来过（用户同意了）：插屏、横幅按它判断，不跟着激励视频此刻有没有加载好走 */
  private started = false;
  /** 广告请求资格已关闭（原生报了 consent: false，还没收到新的 started）：期间晚到的 ready 一律不算 */
  private denied = false;
  /** 原生说这一版没有广告（game.json 关了广告、包里没有广告 SDK） */
  private off = false;
  /** UMP 说这个用户要有「隐私选项」入口（欧洲等地）；没说之前不出入口 */
  private privacyRequired = false;
  /** 这一局已经记过的拉广告失败（种类 + 错误码）：失败会隔一阵重试，同一种只记一次 */
  private failsLogged = new Set<string>();
  /** 每种广告最近一次失败（广告测试页看，查「为什么没有广告」）：format → 「错误码 说明」 */
  private lastFail = new Map<string, string>();
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
      if (r.off === true) this.off = true;
      if (r.consent === false) {
        // 没同意（或在隐私选项里改成不同意）：插屏、横幅也停，已显示的横幅收掉。之后只有新的 started（原生重新确认同意、SDK 启动）能恢复；
        // 资格关闭前发出的加载请求晚到的 ready: true 不算
        this.denied = true;
        this.started = false;
        this.ready = false;
        native.jsbBridgeWrapper.dispatchEventToNative(EV.banner, JSON.stringify({ show: false }));
      } else {
        if (r.started === true) this.denied = false;
        if (this.denied) this.ready = false;
        else {
          this.ready = r.ready === true;
          // started：原生初始化完成时单独发，激励视频加载好也算
          if (this.ready || r.started === true) this.started = true;
        }
      }
      if (was !== this.ready) this.onAdsChange();
    });
    bridge.addNativeEventListener(EV.consent, (arg: string) => {
      const was = this.privacyRequired;
      this.privacyRequired = parse(arg).privacy === true;
      if (was !== this.privacyRequired) this.onAdsChange();
    });
    // 拉广告失败（「为什么没有广告」）：记一条埋点，同一种广告、同一个错误码这一局只记一次（失败后会隔 15 秒起加倍重试）
    bridge.addNativeEventListener(EV.adfail, (arg: string) => {
      const r = parse(arg);
      const format = String(r.format ?? '');
      const code = typeof r.code === 'number' ? r.code : -1;
      this.lastFail.set(format, `${code} ${String(r.msg ?? '')}`.slice(0, 120));
      const key = `${format}:${code}`;
      if (this.failsLogged.has(key)) return;
      this.failsLogged.add(key);
      console.warn(`[ads] ${format} 拉取失败 ${code} ${String(r.msg ?? '')}`);
      this.track('ad_load_fail', { format, code });
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
    // 插屏自己有没有加载好由原生判断（没有就马上回 shown: false）；不看激励视频此刻好没好
    if (!this.started || this.off) return false;
    const r = await this.ask(EV.interstitial, { placement }, INTERSTITIAL_TIMEOUT);
    return r.shown === true;
  }

  override showBanner(_placement: string): void {
    if (this.started && !this.off) native.jsbBridgeWrapper.dispatchEventToNative(EV.banner, JSON.stringify({ show: true }));
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
    if (cap === 'ads') return this.hasAds();
    // 隐私选项入口：有广告、而且 UMP 说这个用户需要（欧洲等地）才出；有广告就出的话，台湾等地的玩家看到一个点了没反应的按钮
    if (cap === 'privacy_options') return this.hasAds() && this.privacyRequired;
    // 广告测试页：入口只在测试模式里出（devtools/testMode.ts），上架包也能看原生广告状态
    if (cap === 'ad_test') return this.hasAds();
    // 隐私政策和有没有广告无关，一直要有（苹果 5.1.1、Google Play 用户数据政策）
    if (cap === 'privacy_policy') return !!this.cfg?.privacyPolicy;
    return cap === 'share' || cap === 'vibrate';
  }

  override adStatus(): string[] {
    const unit = this.cfg ? adUnits(this.cfg, this.id).rewarded : '';
    const lines = [
      `SDK ${this.started ? '已启动' : '未启动'} · 同意 ${this.denied ? '拿不到（consent:false）' : '正常'} · 激励视频 ${this.ready ? '已拉到' : '没拉到'}`,
      `激励视频广告位 ${unit.includes('3940256099942544') ? '（Google 测试位）' : ''}${unit || '（没配）'}`,
    ];
    if (this.lastFail.size === 0) lines.push('还没有失败记录');
    for (const [f, m] of this.lastFail) lines.push(`${f} 失败：${m}`);
    return lines;
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
