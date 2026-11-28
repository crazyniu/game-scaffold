// 界面外壳：分层、页面切换、顶栏、提示条。
// 没有底栏：主页是总入口，别的页面都从主页点进去、左上角返回（docs/01）；顶栏按需显示：主页、商店。
import { Label, Node, UITransform, Vec3, tween } from 'cc';
import * as Album from '../core/meta/album';
import * as PlayerData from '../core/meta/playerData';
import * as Lives from '../core/meta/lives';
import { App } from '../services/app';
import { now } from '../services/clock';
import { fadeIn, popIn } from './fx';
import { COINS_SHOWN_MAX, COLOR, Capsule, at, fmtCoins, hex, blockInput, box, capsule, fit, img, keyButton, onTap, opacity, pageTitle, plate, setImg, slice, text, tint, resizePlate, textWidth } from './kit';
import { closeAllPopups, initPopups } from './popup';
import { Screen } from './screen';

/** 根页面：回到这里返回历史就清空 */
const HOME = 'home';
/** 按关开放的页面对应的功能开放项；没开放时点进去是锁页（docs/01） */
const PAGE_FEATURE: Record<string, string> = { collect: 'album', tasks: 'tasks', map: 'levelSelect' };
/** 页面最底下留的空（再加上机型的安全区，Screen.bottom 已经算进去了） */
export const PAGE_BOTTOM = 24;

/** 子页面页头的中线离屏幕顶多远、返回键多大、标题牌多高 */
export const HEAD_Y = 76;
const HEAD_KEY = 88;
/** 微信小游戏里的返回键（页头在胶囊那一行，比平常小一点） */
const HEAD_KEY_CAP = 76;
const HEAD_TITLE = 76;
/** 页头下面的内容从这里开始（离屏幕顶） */
export const HEAD_BOTTOM = 136;

/** 金币条：宽、高、字号 */
const COINS_W = 196;
const COINS_H = 64;

/** 微信小游戏里子页面的金币条放在胶囊那一行下面：它的中线 */
function coinsRowY(): number {
  return Screen.headY - Screen.headH / 2 - 10 - COINS_H / 2;
}

/**
 * 子页面的页头（各页同一个位置、同一个大小）：左上角返回键，标题牌居中；要花金币的页面右边再放一条金币数。
 * 微信小游戏（有胶囊按钮）：返回键和标题挪到胶囊那一行、和胶囊一样高（标题居中，太长就缩小，不压胶囊），
 * 金币条放到下一行的右上角（上面太空；金币别和标题挤一行）。
 * 金币条是局内那种半透明深蓝底、白字（不要白底）。
 * 页面内容从 headBottom(有没有金币条) 往下排。返回金币条（没要就是 null），页面刷新时自己改数字
 */
export function pageHead(parent: Node, title: string, o: { onBack?: () => void; coins?: boolean } = {}): Capsule | null {
  const y = Screen.headY;
  const onBack = o.onBack ?? (() => ui.back());
  // 微信版返回键 76（原来和胶囊一样高 61，太小）
  const key = Screen.cap ? HEAD_KEY_CAP : HEAD_KEY;
  const back = keyButton(parent, 'blue', 'kit/ic_back', key, onBack);
  at(back, -Screen.W / 2 + 24 + key / 2, y);
  back.name = 'back';
  if (Screen.cap) {
    // 标题牌和平常一样大（缩到胶囊高太小了），居中；最宽只能到胶囊左边那个圆按钮前面（两边对称），字太长就缩小
    // 宽度按字来、两边留得窄一点，不撑到最小 220（标题牌再小一点，别贴着胶囊左边的圆按钮）。
    // 字号各页统一、不缩（标题文字大小统一）：放得下就居中；长标题（每日挑战）往左挪到圆按钮前面，
    // 返回键和圆按钮之间也放不下（很长的英文）才缩字
    const lo = -Screen.W / 2 + 24 + key + 12;
    const hi = Screen.headRight - 8;
    const t = pageTitle(parent, title, HEAD_TITLE, Math.floor(hi - lo), 150, 0.8);
    const tw = (t.getComponent(UITransform) as UITransform).width;
    at(t, Math.max(lo + tw / 2, Math.min(0, hi - tw / 2)), y);
  } else {
    at(pageTitle(parent, title, HEAD_TITLE), 0, y);
  }
  if (!o.coins) return null;
  // 宽度按「9999」定（宽度自适应，右边别空一大截；数字多少条都一样宽，不跳）
  const c = capsule(parent, COINS_W, COINS_H, 'icon/coin', fmtCoins(App.save.data.coins), 30, 'skin/f_hud', String(COINS_SHOWN_MAX));
  const cw = (c.node.getComponent(UITransform) as UITransform).width;
  at(c.node, Screen.W / 2 - 24 - cw / 2, Screen.cap ? coinsRowY() : y);
  return c;
}

/**
 * 子页面的内容从哪往下排（y）：页头下面。微信小游戏里有金币条的页面（金币条在胶囊那一行下面）再往下让出金币那一行
 */
export function headBottom(coins = false): number {
  const base = Screen.headTop - HEAD_BOTTOM;
  return Screen.cap && coins ? Math.min(base, coinsRowY() - COINS_H / 2 - 8) : base;
}

export abstract class Page {
  node!: Node;
  /** 这一页要不要顶栏（金币、生命、设置）：用得到才放，见 docs/01 */
  readonly topBar: boolean = false;
  abstract build(root: Node): void;
  /** 每次切到这一页时调；arg 是 go() 传进来的参数 */
  show(_arg?: unknown): void {}
  hide(): void {}
  /** 存档变了（领奖、花钱）后重画数字、红点 */
  refresh(): void {}
  /** 返回键；返回 false 表示自己处理了 */
  back(): boolean {
    return true;
  }
}

/**
 * 主页顶栏：一整条宝蓝亮面条——左端头像框压在条上，中间一道深色凹槽里放金币（带绿色加号）和生命，右端设置键。
 * 顶上垫一层淡渐变压住背景图
 */
class TopBar {
  node: Node;
  /** 金币数字和图标（别的页面飞金币时当落点） */
  readonly coins: Label;
  readonly coinIcon: Node;
  private lives: Label;
  private timer: Label;
  private lifeRoom = 0;
  private coinRoom = 0;
  private heart: Node;
  private avatar: Node;
  private frame: Node;
  private shownCoins = -1;
  private shownAvatar = '';
  /** 尺寸倍数：平常 1；微信小游戏里缩一点放进胶囊那一行 */
  private k = 1;
  /** 头像框边长 */
  private AV = 92;
  /**
   * 微信小游戏里两条小条按内容定宽、从左往右挨着排（宽度自适应）：金币条按「9999」定宽（不随数字跳），
   * 生命条随内容（回满前多一截倒计时）。平常（App、浏览器）两条平分头像和设置键之间的宽
   */
  private fitWidth = false;
  private lifeTap!: Node;
  private lifeX0 = 0;
  private PH = 72;

  constructor(parent: Node, actions: { coins: () => void; lives: () => void; settings: () => void; profile: () => void }) {
    // 平面顶栏（新设计）：不再有一整条底板，四块东西各自浮在场景上——
    // 头像方块 | 金币小条（带绿色加号）| 生命小条（回满前带倒计时）| 设置键。两条小条是不凸起的白色圆角块，字深蓝不描边（容器一律是白的）。
    // 微信小游戏（有胶囊按钮）：整条挪到胶囊那一行、和胶囊一样高，右边停在胶囊左边（上面太空）；
    // 那一行放上设置键太挤，设置键挪到主页底部「开始」的左边（HomePage），这里只放头像、金币、生命
    const withKey = !Screen.cap;
    // 微信版：条和字按 0.84 倍（原来缩到胶囊高 0.73 倍，太小），头像单独放大到 84；整排宽按字体量过放得下
    const k = Screen.cap ? 0.84 : 1;
    this.k = k;
    const left = -Screen.W / 2 + 20;
    const right = Screen.cap ? Screen.headRight : Screen.W / 2 - 20;
    const BW = right - left;
    this.node = box('topbar', parent, Screen.W, 120 * k);
    at(this.node, 0, Screen.headY);
    const L = left;
    const G = Math.round(14 * k);
    const AV = Screen.cap ? 84 : 92;
    this.AV = AV;
    const KEY = withKey ? 84 * k : 0;
    const PH = 72 * k;
    // 头像
    this.frame = img(this.node, 'skin/f_avatar', AV, AV, 'avatarFrame');
    at(this.frame, L + AV / 2, 0);
    this.avatar = img(this.frame, 'icon/avatar', (70 * AV) / 92, (70 * AV) / 92, 'avatar');
    at(this.avatar, 0, (5 * AV) / 92);
    onTap(this.frame, actions.profile);
    // 设置
    if (withKey) at(keyButton(this.node, 'blue', 'kit/ic_gear', KEY, actions.settings), right - KEY / 2, 0);
    // 两条小条平分头像和设置键之间的宽：金币略宽（最多 7 位数 + 加号）
    const room = BW - AV - KEY - G * (withKey ? 3 : 2);
    const CW = Math.round(room * 0.54);
    const lw = room - CW;
    this.fitWidth = !withKey;
    this.PH = PH;
    const coinTap = plate(this.node, 'skin/f_dock', CW, PH, 'coins');
    // 数字放在条的正中线上（按字体量过：数字的字形中心就在节点中心，字没上下居中）
    this.coins = text(coinTap, String(COINS_SHOWN_MAX), Math.round(36 * k), { align: 'left' });
    // 按内容定宽：图标区 76 + 「9999」的宽 + 10 + 加号区 61
    // +2：留一点余量，免得「9999」差零点几像素被缩一号字
    const cw = this.fitWidth ? Math.round((76 + 10 + 61) * k + textWidth(this.coins) + 2) : CW;
    if (this.fitWidth) resizePlate(coinTap, cw, PH);
    at(coinTap, L + AV + G + cw / 2, 0);
    this.coinIcon = img(coinTap, 'icon/coin', 58 * k, 58 * k, 'icon');
    at(this.coinIcon, -cw / 2 + 38 * k, 0);
    at(this.coins.node, -cw / 2 + 76 * k, 0);
    at(keyButton(coinTap, 'green', 'kit/ic_plus', 50 * k, null, 0.5), cw / 2 - 36 * k, 0);
    this.coinRoom = cw - (76 + 36 + 25 + 10) * k;
    onTap(coinTap, actions.coins);
    // 生命：图标 + 数量，回满前后面跟一个小号倒计时
    const lifeTap = plate(this.node, 'skin/f_dock', lw, PH, 'lives');
    this.lifeTap = lifeTap;
    this.lifeRoom = this.fitWidth ? right - (L + AV + G + cw + G) : lw;
    this.lifeX0 = L + AV + G + cw + G;
    at(lifeTap, this.lifeX0 + lw / 2, 0);
    this.heart = img(lifeTap, 'icon/heart', 58 * k, 58 * k, 'icon');
    at(this.heart, -lw / 2 + 38 * k, 0);
    this.lives = text(lifeTap, '5/5', Math.round(36 * k), { align: 'left' });
    at(this.lives.node, -lw / 2 + 76 * k, 0);
    this.timer = text(lifeTap, '', Math.round(24 * k), { align: 'left', color: hex('#5E86C0') });
    onTap(lifeTap, actions.lives);
  }

  refresh(): void {
    const s = App.save.data;
    const eco = App.config.eco;
    const t = now();
    if (this.shownCoins !== s.coins) {
      this.coins.string = fmtCoins(s.coins);
      fit(this.coins, this.coinRoom, Math.round(36 * this.k), Math.round(22 * this.k));
      if (this.shownCoins >= 0) popIn(this.coins.node, 0, 0.2);
      this.shownCoins = s.coins;
    }
    // 集齐收藏的头像框：换成金色
    const k = this.k;
    const av0 = this.AV;
    setImg(this.frame, Album.hasFrame(s) ? 'skin/f_avatar_gold' : 'skin/f_avatar', av0, av0);
    // 头像换成收藏生物（docs/01）
    const av = PlayerData.avatarOf(s);
    if (av !== this.shownAvatar) {
      this.shownAvatar = av;
      setImg(this.avatar, av ? `card/${av}` : 'icon/avatar', (70 * av0) / 92, (70 * av0) / 92);
    }
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    let tail = '';
    if (Lives.isUnlimited(s, t)) {
      setImg(this.heart, 'icon/heart_inf', 58 * k, 58 * k);
      this.lives.string = '∞';
      tail = mmss(Lives.unlimitedLeft(s, t));
    } else {
      setImg(this.heart, 'icon/heart', 58 * k, 58 * k);
      const n = Lives.count(s, eco, t);
      const full = n >= eco.lives.max;
      this.lives.string = full ? `${n}/${eco.lives.max}` : String(n);
      if (!full) tail = mmss(Lives.secondsToNext(s, eco, t));
    }
    this.timer.string = tail;
    this.lives.updateRenderData(true);
    const lw = (this.lives.node.getComponent(UITransform) as UITransform).width;
    if (this.fitWidth) {
      // 生命条随内容定宽：图标区 76 + 数量 +（倒计时：8 + 倒计时宽）+ 右边留 20，最宽到胶囊左边
      fit(this.timer, this.lifeRoom - (76 + 8 + 20) * k - lw, Math.round(24 * k), Math.round(18 * k));
      const tw = tail ? 8 * k + textWidth(this.timer) : 0;
      const w = Math.min(this.lifeRoom, Math.round(76 * k + lw + tw + 20 * k));
      resizePlate(this.lifeTap, w, this.PH);
      at(this.lifeTap, this.lifeX0 + w / 2, 0);
      at(this.heart, -w / 2 + 38 * k, 0);
      at(this.lives.node, -w / 2 + 76 * k, 0);
      at(this.timer.node, -w / 2 + 76 * k + lw + 8 * k, -2 * k);
      return;
    }
    const tx = this.lives.node.position.x + lw + 8 * k;
    at(this.timer.node, tx, -2 * k);
    // 倒计时最多写到这一条的右边留 18 的地方
    fit(this.timer, this.lifeRoom / 2 - 18 * k - tx, Math.round(24 * k), Math.round(18 * k));
  }
}

export class Shell {
  root!: Node;
  bg!: Node;
  pages!: Node;
  bars!: Node;
  popups!: Node;
  toasts!: Node;
  fx!: Node;
  topbar!: TopBar;
  private registry = new Map<string, () => Page>();
  private built = new Map<string, Page>();
  private current: { name: string; page: Page } | null = null;
  /** 从主页一路点进来经过的页面，返回键照着它往回走 */
  private history: string[] = [];

  /** 当前页面的名字（没有页面时是空串） */
  get pageName(): string {
    return this.current?.name ?? '';
  }

  init(canvas: Node, topActions: ConstructorParameters<typeof TopBar>[1]): void {
    this.root = box('ui', canvas, Screen.W, Screen.H);
    this.bg = box('bg', this.root, Screen.W, Screen.H);
    this.pages = box('pages', this.root, Screen.W, Screen.H);
    this.bars = box('bars', this.root, Screen.W, Screen.H);
    this.popups = box('popups', this.root, Screen.W, Screen.H);
    this.fx = box('fx', this.root, Screen.W, Screen.H);
    this.toasts = box('toasts', this.root, Screen.W, Screen.H);
    initPopups(this.popups);
    this.topbar = new TopBar(this.bars, topActions);
  }

  register(name: string, make: () => Page): void {
    this.registry.set(name, make);
  }

  page<T extends Page>(name: string): T {
    let p = this.built.get(name);
    if (!p) {
      const make = this.registry.get(name);
      if (!make) throw new Error(`没有这个页面：${name}`);
      p = make();
      p.node = box(name, this.pages, Screen.W, Screen.H);
      p.build(p.node);
      p.node.active = false;
      this.built.set(name, p);
    }
    return p as T;
  }

  get currentName(): string {
    return this.current?.name ?? '';
  }

  /** 切页面。主页是根，别的页面进历史，返回键回到上一页；回到主页历史清空 */
  go(name: string, arg?: unknown): void {
    this.open(name, arg, true);
  }

  private open(name: string, arg: unknown, push: boolean): void {
    // 没开放的功能：换成锁页（docs/01：入口是灰的带锁，但可以点进去看锁页）
    const f = PAGE_FEATURE[name];
    if (f && !App.featureOpen(f)) {
      name = 'lock';
      arg = { feature: f };
    }
    const next = this.page(name);
    const prev = this.current;
    if (prev && prev.name === name) {
      next.show(arg);
      this.refreshTopbar();
      return;
    }
    closeAllPopups();
    // 进了哪一页（Firebase 的屏幕浏览报告，docs/05 第 7 节）；同一页刷新不记
    App.platform.track('screen_view', { screen_name: name, screen_class: name });
    if (prev) {
      prev.page.hide();
      prev.page.node.active = false;
    }
    // 要去的页面已经在历史里（如 局内 → 结算 → 下一关）：退回到那一层，历史不会越走越长
    const seen = this.history.indexOf(name);
    if (name === HOME) this.history = [];
    else if (seen >= 0) this.history.length = seen;
    else if (prev && push) this.history.push(prev.name);
    this.current = { name, page: next };
    next.node.active = true;
    next.show(arg);
    fadeIn(next.node, 0.15);
    this.topbar.node.active = next.topBar;
    // show() 已经把页面画好了，这里只刷顶栏：原来还调一遍页面的 refresh()，收藏、任务、地图等整页又重建一次，
    // 刚建好的进场动画也被销毁
    this.refreshTopbar();
  }

  back(): void {
    if (!this.current || !this.current.page.back()) return;
    this.open(this.history.pop() ?? HOME, undefined, false);
  }

  private refreshTopbar(): void {
    try {
      if (this.topbar.node.active) this.topbar.refresh();
    } catch (e) {
      reportError('topbar.refresh', e);
    }
  }

  /** 存档变了以后调：当前页、顶栏一起刷新 */
  refresh(): void {
    // 各自兜住：一块出错不连累别的
    for (const [name, f] of [
      ['page', () => this.current?.page.refresh()],
      ['topbar', () => this.topbar.node.active && this.topbar.refresh()],
    ] as const) {
      try {
        f();
      } catch (e) {
        reportError(`${name}.refresh`, e);
      }
    }
  }

  /** 换语言：页面全部按新文案重建，回到当前页（局内、结算、锁页回主页） */
  rebuild(topActions: ConstructorParameters<typeof TopBar>[1]): void {
    const name = this.current?.name ?? HOME;
    closeAllPopups();
    for (const p of this.built.values()) p.node.destroy();
    this.built.clear();
    this.current = null;
    this.history = [];
    this.topbar.node.destroy();
    this.topbar = new TopBar(this.bars, topActions);
    this.go(name === 'game' || name === 'result' || name === 'lock' ? HOME : name);
  }

  /** 屏幕中间偏上的一条提示，1.6 秒后消失 */
  toast(msg: string): void {
    const n = slice(this.toasts, 'kit/capsule', Math.min(Screen.W - 80, msg.length * 30 + 90), 80, 'toast');
    at(n, 0, 220);
    text(n, msg, 32);
    popIn(n, 0, 0.2);
    tween(n)
      .delay(1.4)
      .by(0.3, { position: new Vec3(0, 40, 0) })
      .call(() => n.destroy())
      .start();
    tween(opacity(n)).delay(1.4).to(0.3, { opacity: 0 }).start();
  }

  /** 全屏压暗挡住操作（广告、读关卡时） */
  busy(on: boolean): void {
    const old = this.toasts.getChildByName('busy');
    if (!on) {
      old?.destroy();
      return;
    }
    if (old) return;
    const b = tint(this.toasts, Screen.W, Screen.H, COLOR.dim, 'busy');
    blockInput(b);
    opacity(b).opacity = 120;
  }
}

export const ui = new Shell();

let errorSink: ((msg: string) => void) | null = null;
export function setErrorSink(f: (msg: string) => void): void {
  errorSink = f;
}
/** 调试构建把错误画在屏幕顶上（Mac 上截图就能看到），正式构建只写日志 */
export function reportError(where: string, e: unknown): void {
  const msg = `${where}: ${e instanceof Error ? `${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}` : String(e)}`;
  console.error(msg);
  errorSink?.(msg);
}

/** 进场：依次弹出（总时长 ≤ 0.8 秒，docs/09） */
export function enterStagger(nodes: Node[], step = 0.06): void {
  nodes.forEach((n, i) => popIn(n, Math.min(0.5, i * step), 0.3));
}

export function width(n: Node): number {
  return (n.getComponent(UITransform) as UITransform).width;
}
