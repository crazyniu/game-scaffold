// 启动：画布与相机 → 加载页 → 资源包（微信版从网上下）→ 平台、配置、存档 → 文案、字体、界面图 → 界面外壳 → 主页。
// 加载页见 docs/09：每一步按量占一段进度；哪步下载失败就停在那步，点「重试」从那步接着来。
// 唯一挂在场景里的脚本，界面全部由代码生成（docs/09）。
import { _decorator, Camera, Canvas, Color, Component, Label, Layers, Node, ResolutionPolicy, UITransform, Widget, profiler, tween, view } from 'cc';
import { DEBUG } from 'cc/env';
import { GamePage } from './game/gameView';
import { ResultPage } from './game/result';
import { HomePage } from './pages/home';
import { AdTestPage } from './pages/adtest';
import { LabPage } from './devtools/labPage';
import * as TestMode from './devtools/testMode';
import { lab } from './devtools/levelLab';
import { applyTier, labHooks } from './game/labHooks';
import { PlatformDebug } from './platform/platformDebug';
import { mockAdView } from './ui/mockAd';
import { CollectPage } from './pages/collect';
import { DailyPage } from './pages/daily';
import { LevelsPage } from './pages/levels';
import { MapPage } from './pages/map';
import { profilePopup } from './pages/profile';
import { RankPage } from './pages/rank';
import { TasksPage } from './pages/tasks';
import { WheelPage } from './pages/wheel';
import { ShopPage } from './pages/shop';
import { LockPage } from './pages/lock';
import { App } from './services/app';
import { initAudio, sfx, startMusic } from './services/audio';
import { loadStrings, matchLanguage, onLanguage, tr } from './ui/i18n';
import { fitLog, setTapSound } from './ui/kit';
import * as Popups from './ui/popups';
import { livesPopup, settingsPopup, switchLanguage } from './ui/popups';
import { closeAllPopups } from './ui/popup';
import { signInPopup } from './pages/signin';
import * as Flow from './game/flow';
import { ensureResources, gameFrames, loadBootBundle, loadFont, loadFrames, rewardFrames, startupFrames } from './ui/res';
import { LoadingView } from './ui/loading';
import { loadPlatformConfig } from './platform/platformConfig';
import { Screen } from './ui/screen';
import { reportError, setErrorSink, ui } from './ui/shell';

const { ccclass } = _decorator;

/** 开局用哪种语言：设置里选过、并且这一端带这种语言就用它，否则按系统语言（docs/10 第 8 节） */
function startLanguage(): string {
  const langs = App.platform.languages;
  const saved = App.save.data.settings.lang;
  if (saved && langs.includes(saved)) return saved;
  return matchLanguage(App.platform.systemLanguage(), langs);
}

/** 设计分辨率：750×1334 竖屏，适配宽度（docs/09） */
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;

/** 加载失败后隔几秒自动再试（第 1、2、3 次……，最后一个一直用）；前 SILENT_RETRIES 次不出失败页。
 * 启动时还读不到配置（配置就在要下载的资源里），所以写在这里 */
const RETRY_WAIT = [1, 2, 4, 5];
const SILENT_RETRIES = 3;

@ccclass('Boot')
export class Boot extends Component {
  protected override onLoad(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, Screen.wide() ? ResolutionPolicy.FIXED_HEIGHT : ResolutionPolicy.FIXED_WIDTH);
    Screen.init();
    profiler.hideStats();
    const canvas = this.createCanvas();
    if (DEBUG) this.errorOverlay(canvas);
    const loading = new LoadingView(canvas);
    loadBootBundle()
      .then((b) => loading.useBundle(b))
      .catch((e: unknown) => console.warn('boot 包读不出来', e));
    this.load(loading)
      .then(() => this.boot(canvas))
      .then(() => loading.finish())
      .catch((e: unknown) => {
        if (DEBUG) reportError('启动失败', e);
        console.error(e);
      });
  }

  /** 加载的几步（[进度占比, 做什么]）；失败停在那一步，显示「重试」，点了从那一步接着来 */
  private load(view: LoadingView): Promise<void> {
    let lang = 'zh_CN';
    const steps: [number, (p: (done: number, total: number) => void) => Promise<void>][] = [
      [0.04, () => ensureResources()],
      [
        0.04,
        async () => {
          await App.start();
          Screen.applyPlatform(App.platform);
          lang = startLanguage();
          view.setLanguage(lang, App.platform.hasCapability('health_notice'));
          void loadPlatformConfig().then((c) => {
            view.setVersion(c.version);
            // 难度调试页：开发版才有（正式版自动不出，代码留着），game.json 的 levelLab 写 false 可以连开发版也关掉
            // 难度调试页、机器人代打：所有包都在，入口藏在测试模式里（设置标题 10 秒内连点 10 下，devtools/testMode.ts）；game.json 的 levelLab 写 false 整个关掉
            TestMode.init(App.platform);
            if (c.levelLab !== false) lab.init(App.platform, applyTier);
          }).catch(() => undefined);
        },
      ],
      [0.02, () => loadStrings(lang)],
      [0.04, () => loadFont(lang).then(() => undefined)],
      [
        0.75,
        (p) => {
          return loadFrames([...startupFrames(), ...this.startupCards()], p);
        },
      ],
    ];
    let i = 0;
    let base = 0;
    // 下载失败自动重试（微信审核驳回过「打不开」：审核员的手机刚启动时微信报「offline mode」、
    // 资源一个都没下下来，停在失败页没人点重试）。前 SILENT_RETRIES 次不出失败页、进度条停着悄悄再试；
    // 之后出「网络不太好」和「重试」，后台照样隔一会儿自己再试，网络好了直接进游戏
    let fails = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let waiting = false;
    return new Promise((resolve) => {
      const retry = (): void => {
        if (!waiting) return;
        waiting = false;
        if (timer) clearTimeout(timer);
        timer = null;
        view.hideFail();
        next();
      };
      const next = (): void => {
        if (i >= steps.length) return resolve();
        const [w, run] = steps[i];
        run((done, total) => view.setProgress(base + (w * done) / Math.max(1, total)))
          .then(() => {
            fails = 0;
            base += w;
            view.setProgress(base);
            i++;
            next();
          })
          .catch((e: unknown) => {
            console.warn('加载失败', e);
            fails++;
            waiting = true;
            if (fails > SILENT_RETRIES) view.showFail(retry);
            timer = setTimeout(retry, RETRY_WAIT[Math.min(fails, RETRY_WAIT.length) - 1] * 1000);
          });
      };
      next();
    });
  }

  /** 首页出来之前读好的卡面：主页中间展示的、头像（其余卡面在首页出来后后台读） */
  private startupCards(): string[] {
    const { config, save } = App;
    const ids = config.ui.homeDeco.hero.map(([id]) => id);
    if (save.data.avatar) ids.push(save.data.avatar);
    return ids.map((id) => `card/${id}`);
  }

  private async boot(canvas: Node): Promise<void> {
    // 音效不挡启动：后台读，读到之前没声音
    void initAudio(this.node);
    setTapSound((n) => sfx(n));
    App.save.onFail = () => ui.toast(tr('SAVE_FAIL'));
    startMusic();
    const topActions = {
      coins: () => ui.go('shop'),
      lives: () => livesPopup(),
      settings: () => settingsPopup('home'),
      profile: () => profilePopup(),
    };
    ui.init(canvas, topActions);
    // 广告拉到了 / 改了同意：商城、抽奖、每日挑战这些已经打开的页面跟着亮起来（局内不重画）
    App.platform.onAdsChange = () => {
      if (ui.currentName !== 'game') ui.refresh();
    };
    // 调试平台：广告弹模拟广告页（docs/01）；机器人代打时直接算看完
    if (App.platform instanceof PlatformDebug) App.platform.view = mockAdView(() => ui.toasts);
    ui.register('home', () => new HomePage());
    ui.register('game', () => new GamePage());
    ui.register('result', () => new ResultPage());
    ui.register('lock', () => new LockPage());
    ui.register('shop', () => new ShopPage());
    ui.register('collect', () => new CollectPage());
    ui.register('tasks', () => new TasksPage());
    // 好友周榜：先隐藏，没有入口，等接平台好友榜时再放出来；调试时 ./run.sh page rank 能看
    ui.register('rank', () => new RankPage());
    ui.register('levels', () => new LevelsPage());
    ui.register('map', () => new MapPage());
    ui.register('daily', () => new DailyPage());
    ui.register('wheel', () => new WheelPage());
    ui.register('adtest', () => new AdTestPage());
    ui.register('lab', () => new LabPage(labHooks));
    onLanguage(() => ui.rebuild(topActions));
    // 调试构建：控制台里 gsDebug.ui.go('tasks')、gsDebug.Popups.livesPopup() 直接打开页面、弹窗（截图审查用，./run.sh cdp eval）
    if (DEBUG) (globalThis as unknown as Record<string, unknown>).gsDebug = { ui, App, Popups, Flow, signInPopup, profilePopup, closeAllPopups, fitLog, setLanguage: switchLanguage };
    // 调试：直接进关（./run.sh level N、./run.sh auto）；没给关卡号就进当前关
    if (App.flags.play) ui.go('game', { level: App.flags.level > 0 ? App.flags.level : App.save.data.level });
    else if (App.flags.page) ui.go(App.flags.page);
    else ui.go('home');
    // 从脚本开始跑到第一页出来用了几秒：低端机加载慢会让人还没开局就走（docs/05 第 7 节）
    App.platform.track('app_ready', { seconds: Math.round((globalThis.performance?.now() ?? 0) / 100) / 10 });
    // 首页用不到的大图和卡面：首页出来以后在后台接着读，先读局内的，再读结算、开箱用的。
    // 读不下来的用到时再读（进关前 gameView 会等局内的图）
    const later = (keys: string[]) => loadFrames(keys).catch((e: unknown) => console.warn('后台读图没读完，用到时再读', e));
    void later([...gameFrames(), ...App.config.cards.map((c) => `card/${c.id}`)]).then(() => later(rewardFrames()));
    // 顶栏的生命倒计时、无限生命每秒走一次
    tween(this.node)
      .repeatForever(tween(this.node).delay(1).call(() => ui.topbar.node.active && ui.topbar.refresh()))
      .start();
  }

  private createCanvas(): Node {
    const canvasNode = new Node('Canvas');
    canvasNode.layer = Layers.Enum.UI_2D;
    canvasNode.addComponent(UITransform);
    this.node.scene.addChild(canvasNode);
    const cameraNode = new Node('UICamera');
    cameraNode.layer = Layers.Enum.UI_2D;
    cameraNode.setPosition(0, 0, 1000);
    canvasNode.addChild(cameraNode);
    const camera = cameraNode.addComponent(Camera);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.visibility = Layers.Enum.UI_2D;
    camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    camera.clearColor = new Color(18, 74, 160, 255);
    camera.near = 1;
    camera.far = 2000;
    const canvas = canvasNode.addComponent(Canvas);
    canvas.cameraComponent = camera;
    const widget = canvasNode.addComponent(Widget);
    widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
    widget.top = widget.bottom = widget.left = widget.right = 0;
    return canvasNode;
  }

  /** 调试构建：没接住的错误画在屏幕顶上，截图就能看到 */
  private errorOverlay(canvas: Node): void {
    const n = new Node('errors');
    n.layer = Layers.Enum.UI_2D;
    const t = n.addComponent(UITransform);
    t.setContentSize(Screen.W - 20, 10);
    t.setAnchorPoint(0.5, 1);
    canvas.addChild(n);
    n.setPosition(0, Screen.H / 2 - 10, 0);
    const l = n.addComponent(Label);
    l.fontSize = 20;
    l.lineHeight = 24;
    l.color = new Color(255, 60, 60, 255);
    l.overflow = Label.Overflow.RESIZE_HEIGHT;
    l.enableWrapText = true;
    l.string = '';
    const lines: string[] = [];
    setErrorSink((msg) => {
      lines.push(msg);
      l.string = lines.slice(-4).join('\n');
      n.setSiblingIndex(canvas.children.length - 1);
    });
    const g = globalThis as unknown as { addEventListener?: (t: string, f: (e: { error?: unknown; reason?: unknown; message?: string }) => void) => void };
    g.addEventListener?.('error', (e) => reportError('error', e.error ?? e.message));
    g.addEventListener?.('unhandledrejection', (e) => reportError('promise', e.reason));
  }
}
