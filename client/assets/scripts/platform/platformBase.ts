// 平台能力接口，见 docs/04 第 5 节。wx / tt / FBInstant / 原生调用只许出现在 platform/ 里，
// 业务代码只认这个接口，功能差异一律用 hasCapability 判断，不按平台 id 分支（CLAUDE.md 硬性约束 4）。
import { DEBUG } from 'cc/env';

export type AdResult = 'done' | 'skipped' | 'unavailable';

export interface Profile {
  nickname: string;
  /** 头像图片地址；空串 = 用默认头像 */
  avatar: string;
}

export interface RankEntry {
  name: string;
  avatar: string;
  score: number;
}

/** 平台能力名 */
/** ads：这一版有广告（game.json 的 ads.enabled、配了广告位、包里有广告 SDK）；没有时看广告的入口整个隐藏；有但暂时拉不到广告（adsAvailable 为假）时入口也不出现（docs/01） */
/** health_notice：加载页显示健康游戏忠告（中国大陆上线的版本，即微信版） */
/** privacy_policy：设置里有「隐私政策」，点了打开 game.json 的 privacyPolicy 网页（只有 App；微信小游戏打不开网页，不放这个入口） */
export type Capability = 'ads' | 'health_notice' | 'iap' | 'sidebar' | 'add_to_desktop' | 'friend_rank' | 'share' | 'vibrate' | 'ad_test' | 'privacy_options' | 'privacy_policy';

export type VibrateKind = 'light' | 'medium' | 'heavy';

/** 屏幕上的一块区域，单位是平台的窗口坐标（微信是逻辑像素），附窗口宽高，界面层自己换算成设计单位 */
export interface WindowRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  windowWidth: number;
  windowHeight: number;
}

export abstract class PlatformBase {
  abstract readonly id: string;

  /**
   * 开发版：编辑器预览和调试构建（cc/env 的 DEBUG），也就是 ./run.sh 打的包。./package.sh 打的包都是正式构建，不算开发版——
   * 微信上传后的开发版、体验版也不算（打包的都要隐藏，体验版、审核时不能露出来）。
   * 开发版才有的东西（难度调试页等，devtools/）按它显示（只在开发版里显示，代码保留）
   */
  isDevBuild(): boolean {
    return DEBUG;
  }

  async init(): Promise<void> {}

  /** 激励视频。必须完整看完才返回 done */
  async showRewarded(_placement: string): Promise<AdResult> {
    return 'unavailable';
  }

  /** 插屏。真的播出来了返回 true（没拉到、播放失败返回 false，这时不记频控） */
  async showInterstitial(_placement: string): Promise<boolean> {
    return false;
  }

  showBanner(_placement: string): void {}

  hideBanner(): void {}

  /** 广告能不能用变了（拉到了、播完要重新拉、改了同意）时调：界面层在启动时接上，重画当前页 */
  onAdsChange: () => void = () => undefined;

  /** 广告当前能不能用；不能用时界面要降级（改金币支付或隐藏入口，docs/01） */
  adsAvailable(): boolean {
    return false;
  }

  /** 头像昵称；拒绝授权时返回 null（界面用默认头像和随机昵称） */
  async getProfile(): Promise<Profile | null> {
    return null;
  }

  /** 好友周榜（不含自己）。平台不支持时返回空，排行页只显示过关目标 */
  async getRankList(_board: string): Promise<RankEntry[]> {
    return [];
  }

  /** 本地存档读写 */
  loadData(_key: string): string {
    return '';
  }

  saveData(_key: string, _value: string): void {}

  /** 调起普通分享（不发奖励：微信禁止诱导分享，docs/01）。true 表示平台报告分享完成 */
  async share(_payload: Record<string, unknown>): Promise<boolean> {
    return false;
  }

  submitScore(_board: string, _value: number): void {}

  vibrate(_kind: VibrateKind): void {}

  track(_event: string, _params: Record<string, unknown> = {}): void {}

  /** 原生广告现在的状态（SDK、同意、拉没拉到、最近的失败错误码），广告测试页显示；没有就空 */
  adStatus(): string[] {
    return [];
  }

  /** 打开广告的隐私选项（欧洲等地的同意设置）；hasCapability('privacy_options') 时设置里才有入口 */
  openPrivacyOptions(): void {}

  /** 打开隐私政策；hasCapability('privacy_policy') 时设置里才有入口 */
  openPrivacyPolicy(): void {}

  hasCapability(_cap: Capability): boolean {
    return false;
  }

  /**
   * 右上角平台自带的按钮（微信小游戏的「胶囊」：··· 和关闭），游戏的顶栏要让开它。没有返回 null
   */
  menuButton(): WindowRect | null {
    return null;
  }

  /**
   * 安全区（刘海、灵动岛、状态栏、底部手势条之外的区域）。返回 null = 用引擎的 sys.getSafeAreaRect()。
   * 调试平台用它模拟刘海屏
   */
  safeArea(): WindowRect | null {
    return null;
  }

  /** 这一端带的语言（game.json 的 languages，各平台 init 时按自己那份填好），第一个是认不出系统语言时的默认语言 */
  languages: string[] = ['zh_CN', 'en'];

  /** 系统语言，原样返回平台给的写法（zh-Hant-TW、zh_TW、ja-JP、en…），由 ui/i18n 的 matchLanguage 认；拿不到返回 '' */
  systemLanguage(): string {
    return '';
  }

  /** 启动参数：网页是地址栏的 ?level=65&autoplay=1，小游戏是启动 query */
  launchQuery(): Record<string, string> {
    return {};
  }
}
