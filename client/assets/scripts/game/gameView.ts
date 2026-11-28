// 局内页面（底座，换玩法时只改标了「玩法」的几处，见 docs/02）。
// 版式：顶栏（设置 · 进度 · 关卡号 / 倒计时）→ 场地（尽量大）→ 连击计 → 暂存槽 → 技能栏。
// 逻辑在 core 里立即结算，这里按事件播表现（动画不挡操作）。连击的「满屏」：四边光框、放射光、往上冒的光点、升档夸奖、过关庆祝。
import { Color, Label, Node, Sprite, Tween, UITransform, Vec3, tween } from 'cc';
import { Combo } from '../core/meta/combo';
import * as Skills from '../core/meta/skills';
import * as Meta from '../core/meta/meta';
import * as Chapters from '../core/meta/chapters';
import type { DemoLevel } from '../core/demo/level';
import * as Rules from '../core/demo/rules';
import { GameState, Status } from '../core/demo/rules';
import type { GameEvent } from '../core/demo/rules';
import { Rng } from '../core/rng/rng';
import { App } from '../services/app';
import { buzz, sfx } from '../services/audio';
import * as fx from '../ui/fx';
import { language, tr } from '../ui/i18n';
import { artNumber, at, blockInput, box, Capsule, capsule, COLOR, fit, fxImg, iconButton, img, keyButton, lazyImg, onTap, opacity, recycleFx, resizeSlice, setSlice, slice, text, textWidth, tint } from '../ui/kit';
import { Screen } from '../ui/screen';
import { gameFrames, loadFrames } from '../ui/res';
import { popupCount } from '../ui/popup';
import { skillName } from '../ui/popups';
import { Page, ui } from '../ui/shell';
import * as TestMode from '../devtools/testMode';
import { Board } from './board';
import * as Flow from './flow';
import { labTray } from './labHooks';
import { KIND_STYLE, kindBanner, kindTag, levelKind } from './levelKind';

export interface GameArg {
  level: number;
  daily?: boolean;
  /** 每日挑战：这局算哪一天的（进场时定，过了零点结算也算进场那天） */
  day?: number;
  /** 每日挑战的重试怎么付（看过广告 / 金币）；不给 = 当天的免费次 */
  pay?: 'ad' | 'coins';
  /** 难度调试页的演示：电脑按参考解替玩家点，不记成绩、不扣命 */
  demo?: 'route';
}

/** 连击四档的颜色（蓝、金、红、紫） */
const COMBO_COLORS = [new Color(110, 215, 255), new Color(255, 214, 64), new Color(255, 110, 80), new Color(214, 130, 255)];
/** 升档夸奖词的字色 */
const PRAISE_FILL = [new Color(150, 240, 255), new Color(255, 222, 70), new Color(255, 150, 120), new Color(235, 170, 255)];
/** 连击「满屏」的强度，按档位：四边光框亮度、放射光亮度和转一圈的秒数、每秒冒几个光点 */
const FEVER = [
  { frame: 150, rays: 60, turn: 16, rise: 6 },
  { frame: 180, rays: 85, turn: 11, rise: 10 },
  { frame: 210, rays: 110, turn: 8, rise: 14 },
  { frame: 240, rays: 135, turn: 5.5, rise: 18 },
];
const PRAISE_TAG = 9202;
/** 技能键多大、间隔多少 */
const SKILL_S = 104;
const SKILL_GAP = 28;
const BADGE_W = 42;
const BADGE_H = 36;
/** 暂存格的高 */
const SLOT_H = 96;

function mmss(sec: number): string {
  const t = Math.max(0, Math.ceil(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export class GamePage extends Page {
  // ---- 一局的状态
  lv!: DemoLevel;
  s!: GameState;
  arg!: GameArg;
  combo = new Combo();
  /** 局内时钟（秒），连击窗口用 */
  clock = 0;
  moved = false;
  /** 这一局的每日任务进度记过了没有（Flow.endRun） */
  tallied = false;
  ended = false;
  paused = false;
  /** 本关各技能用了几次 */
  used: Record<string, number> = {};
  /** 强制教学用掉的那几次（不算进星级的道具数） */
  freebies = 0;
  /** 技能以外算「用了道具」的：复活 */
  extras = 0;
  /** 这一关要强制教的新技能（解锁关第一次能用上时压暗全屏只让点它）；"" = 没有 */
  tutor = '';
  demoStep = 0;
  /** 玩法：图案号 → 图（收藏卡的前几张，换玩法时换成自己的图） */
  private frames: string[] = [];
  private undoSnap: GameState | null = null;
  private rng = new Rng(Date.now() >>> 0);

  // ---- 画面
  private bg!: Node;
  /** 场景和玩法之间的一层：连击时的放射光、往上冒的光点 */
  private under!: Node;
  private stage!: Node;
  private fly!: Node;
  private board!: Board;
  private progress!: Capsule;
  private clockCap: Capsule | null = null;
  private clockSecond = -1;
  private clockWarn = false;
  private trayY = 0;
  private traySlots: Node[] = [];
  /** 块号 → 暂存槽里那块的节点 */
  private trayNodes = new Map<number, Node>();
  private skillNodes = new Map<string, { node: Node; icon: Node; count: Label; lock: Node; plus: Node; name: Node; badge: Node }>();
  private comboRow!: Node;
  private comboBadge!: Node;
  private comboNum!: Node;
  private comboWord!: Node;
  private comboWordW = 78;
  private comboY = 0;
  private frame!: Node;
  private frameHi = 0;
  private feverRays!: Node;
  private comboTier = -1;
  private comboColor = COLOR.white;
  private riseT = 0;
  private comboBreaking = false;
  private praiseNode: Node | null = null;
  private hintNode: Node | null = null;
  private tutorNode: Node | null = null;
  private kindTagNode: Node | null = null;
  private kindBannerNode: Node | null = null;
  private pointedNode: Node | null = null;
  private nudged = new Set<string>();
  private idle = 0;
  private autoT = 0;
  /** 机器人代打下一步前还要停几秒（随机，humanPause） */
  private autoWait = 1;
  private fieldTop = 0;
  private fieldBottom = 0;
  private total = 0;

  /** 星级按它算：这一关用了几样道具（技能 + 复活，强制教学那几次不算） */
  get items(): number {
    return Math.max(0, this.usedAll - this.freebies) + this.extras;
  }

  get usedAll(): number {
    return Object.values(this.used).reduce((a, b) => a + b, 0);
  }

  get canUndo(): boolean {
    return this.undoSnap !== null;
  }

  /** 这一关的关卡号，每日挑战是 0（「前几关技能免费」不算每日挑战） */
  get freeLevelId(): number {
    return this.arg.daily ? 0 : this.arg.level;
  }

  /** 这一局消掉了几组（每日任务用） */
  get cleared(): number {
    return this.s ? this.s.cleared : 0;
  }

  skillFree(id: string): boolean {
    const eco = App.config.eco;
    return Skills.levelFree(eco, this.freeLevelId, this.usedAll) || Skills.freeAvailable(App.save.data, id, eco);
  }

  build(root: Node): void {
    this.bg = box('bg', root, Screen.W, Screen.H);
    this.under = box('under', root, Screen.W, Screen.H);
    this.stage = box('stage', root, Screen.W, Screen.H);
    this.fly = box('fly', root, Screen.W, Screen.H);
    // 每帧推进：倒计时、连击窗口、提示、代打
    const ticker = box('ticker', root);
    tween(ticker)
      .repeatForever(tween(ticker).delay(1 / 30).call(() => this.update(1 / 30)))
      .start();
  }

  override show(arg?: unknown): void {
    this.arg = arg as GameArg;
    void this.start();
  }

  override back(): boolean {
    Flow.pause(this);
    return false;
  }

  private async start(): Promise<void> {
    ui.busy(true);
    this.ended = true;
    this.under.destroyAllChildren();
    this.stage.destroyAllChildren();
    this.fly.destroyAllChildren();
    const { config, save } = App;
    const id = this.arg.level;
    const file = Meta.levelFile(id, config.levelCount);
    const ease = this.arg.daily || this.arg.demo ? 0 : Meta.easeFor(save.data, config.eco, id);
    try {
      // 玩法：读关卡。微信版资源在网上，读不下来就提示、回主页（不扣命）
      this.lv = await config.loadLevel(file, ease, this.arg.demo ? 0 : labTray());
      this.frames = config.cards.slice(0, this.lv.kinds).map((c) => `card/${c.id}`);
      await loadFrames([...this.frames, ...gameFrames()]).catch(() => loadFrames(this.frames));
    } catch (e) {
      console.warn('关卡读不出来', e);
      ui.toast(tr('BOOT_FAIL'));
      ui.go('home');
      return;
    } finally {
      ui.busy(false);
    }
    if (!Flow.payDaily(this)) return;
    this.s = GameState.fromLevel(this.lv);
    if (this.arg.daily || this.arg.demo) this.s.clock = Infinity;
    this.combo = new Combo();
    this.comboTier = -1;
    this.comboBreaking = false;
    this.clock = 0;
    this.moved = false;
    this.tallied = false;
    this.ended = false;
    this.paused = false;
    this.used = {};
    this.freebies = 0;
    this.extras = 0;
    this.undoSnap = null;
    this.demoStep = 0;
    this.autoT = 0;
    // 统计（Firebase Analytics 推荐的 level_start，coins 是开局时手里的金币）；演示、机器人代打、测试模式不记
    if (!this.arg.demo && !App.flags.autoplay && !TestMode.isOn()) App.platform.track('level_start', { level_name: String(id), level: id, daily: !!this.arg.daily, coins: App.save.data.coins });
    this.autoWait = 1;
    this.idle = 0;
    this.total = this.lv.tiles.length;
    this.layout(true);
    Flow.onLevelStart(this);
  }

  // ---------------------------------------------------------------- 版式

  /** 整个重画（开局、撤销、复活）；intro = 开局的进场动画 */
  private layout(intro: boolean): void {
    this.bg.destroyAllChildren();
    this.under.destroyAllChildren();
    this.stage.destroyAllChildren();
    this.fly.destroyAllChildren();
    this.trayNodes.clear();
    this.traySlots = [];
    this.skillNodes.clear();
    this.nudged.clear();
    this.pointedNode = null;
    this.hintNode = null;
    this.tutorNode = null;
    this.praiseNode = null;
    this.kindBannerNode = null;
    const eco = App.config.eco;
    // 背景：按章节换（bg/chapter_<id>），没配章节就用主页背景
    const chs = Chapters.list(eco);
    const ch = chs.length ? `bg/chapter_${chs[Chapters.forLevel(eco, Meta.levelFile(this.arg.level, App.config.levelCount))].id}` : 'bg/home';
    const bgH = Math.max(Screen.H, Screen.W * 1.5);
    lazyImg(this.bg, ch, (bgH * 1024) / 1536, bgH);

    // ---- 顶栏：微信小游戏（有胶囊）挪到胶囊那一行，设置键在最左；App 设置键在最右。关卡号居中，限时关中间换成倒计时
    const hudY = Screen.cap ? Screen.headY : Screen.top - (Screen.notchTop > 0 ? 33 + 8 : 52);
    const levelName = this.arg.daily ? tr('UI_TAB_DAILY') : tr('UI_LEVEL', this.arg.level);
    const rightEdge = Screen.cap ? Screen.headRight : Screen.W / 2 - 24 - 74 - 12;
    let progressRight = -Screen.W / 2;
    const midX = (w: number): number => Math.min(rightEdge - w / 2, Math.max(0, progressRight + 12 + w / 2));
    const timed = this.s.clock !== Infinity;
    const h = Screen.cap ? Screen.headH : 66;
    let x0 = -Screen.W / 2 + 24;
    if (Screen.cap) {
      const gearW = 76;
      at(iconButton(this.stage, 'kit/round_blue', 'kit/ic_gear', gearW, () => Flow.pause(this)), x0 + gearW / 2, hudY);
      x0 += gearW + 10;
    }
    // 进度：消掉了几块 / 一共几块（宽度按最长的写法定，整关不变）
    this.progress = capsule(this.stage, Math.round((196 * h) / 66), h, 'icon/star', '', Math.round((34 * h) / 66), 'skin/f_hud', `${this.total}/${this.total}`);
    const realW = (this.progress.node.getComponent(UITransform) as UITransform).width;
    at(this.progress.node, x0 + realW / 2, hudY);
    progressRight = x0 + realW;
    this.levelTitle(levelName, hudY, midX, timed);
    this.clockCap = null;
    this.clockSecond = -1;
    this.clockWarn = false;
    if (timed) {
      this.clockSecond = Math.ceil(this.s.clock);
      this.clockCap = capsule(this.stage, Math.round((120 * h) / 66), h, null, mmss(this.s.clock), Math.round((34 * h) / 66), 'skin/f_hud');
      const cw = (this.clockCap.node.getComponent(UITransform) as UITransform).width;
      at(this.clockCap.node, midX(cw), hudY);
    }
    if (!Screen.cap) at(iconButton(this.stage, 'kit/round_blue', 'kit/ic_gear', 74, () => Flow.pause(this)), Screen.W / 2 - 24 - 37, hudY);

    // ---- 技能栏：贴着底部安全区
    const skillY = Screen.bottom + (Screen.safeBottom > 0 ? 10 : 26) + SKILL_S / 2;
    const ids = Skills.ids(eco);
    ids.forEach((sid, i) => this.buildSkill(sid, (i - (ids.length - 1) / 2) * (SKILL_S + SKILL_GAP), skillY));

    // ---- 暂存槽：技能栏上面
    this.trayY = skillY + SKILL_S / 2 + 30 + SLOT_H / 2;
    const cap = this.s.trayCap;
    const sw = this.slotW();
    for (let i = 0; i < cap; i++) {
      const sl = slice(this.stage, 'kit/slot', sw, SLOT_H, `slot${i}`);
      at(sl, this.slotX(i), this.trayY);
      this.traySlots.push(sl);
    }

    // ---- 连击计：暂存槽上面一行（放在特效层，不挡点击）
    this.comboY = this.trayY + SLOT_H / 2 + 56;
    this.comboRow = box('combo', this.fly, 420, 120);
    at(this.comboRow, 0, this.comboY);
    this.comboBadge = box('badge', this.comboRow, 420, 120);
    // 「连击」：中文用艺术字图，其它语言用字
    if (language() === 'zh_CN') {
      this.comboWord = img(this.comboBadge, 'skin/j_combo_word', 110, 90, 'word');
      (this.comboWord.getComponent(UITransform) as UITransform).setAnchorPoint(0, 0.5);
      this.comboWordW = 110;
    } else {
      const word = text(this.comboBadge, tr('UI_COMBO_WORD'), 44, { align: 'left' });
      word.updateRenderData(true);
      this.comboWord = word.node;
      this.comboWordW = (word.node.getComponent(UITransform) as UITransform).width;
    }
    this.comboNum = box('num', this.comboBadge);
    this.comboRow.active = false;
    // 连击光框（四边柔光）和放射光（垫在玩法后面）
    this.frame = box('frame', this.under, Screen.W, Screen.H);
    for (const sx of [-1, 1]) at(img(this.frame, 'kit/fx_glow', 300, Screen.H * 1.2, 'side'), (sx * Screen.W) / 2, 0);
    for (const sy of [-1, 1]) at(img(this.frame, 'kit/fx_glow', Screen.W * 1.2, 280, 'cap'), 0, (sy * Screen.H) / 2);
    opacity(this.frame).opacity = 0;
    const raysS = Math.hypot(Screen.W, Screen.H) * 1.15;
    this.feverRays = img(this.under, 'kit/fx_rays', raysS, raysS, 'rays');
    opacity(this.feverRays).opacity = 0;

    // ---- 场地：顶栏和连击计之间的全部高度（玩法）
    this.fieldTop = hudY - h / 2 - 20;
    this.fieldBottom = this.comboY + 50;
    const fh = this.fieldTop - this.fieldBottom;
    at(this.feverRays, 0, (this.fieldTop + this.fieldBottom) / 2);
    const holder = box('fieldHolder', this.stage, Screen.W, fh);
    at(holder, 0, (this.fieldTop + this.fieldBottom) / 2);
    this.board = new Board(holder, Screen.W - 24, fh, this.lv, this.frames, (i) => this.tapTile(i));
    this.board.build(this.s, intro);
    // 暂存槽里已经有的块（撤销、复活后重画）
    for (const t of this.s.tray) this.trayNodes.set(t, this.trayTile(t));
    this.layoutTray(0, -1, true);
    this.refreshHud();
    this.refreshSkills();
  }

  private slotW(): number {
    return Math.min(96, (Screen.W - 40) / this.s.trayCap - 8);
  }

  private slotX(i: number): number {
    const cap = this.s.trayCap;
    const step = Math.min(104, (Screen.W - 40) / cap);
    return -((cap - 1) * step) / 2 + i * step;
  }

  /** 暂存槽里的一块（玩法：长得和场上的块一样） */
  private trayTile(t: number): Node {
    const S = this.slotW() - 6;
    const n = slice(this.fly, 'kit/panel_glass', S, S, `tray${t}`);
    img(n, this.frames[this.s.tiles[t].kind] ?? 'icon/star', S * 0.74, S * 0.74, 'art');
    at(n, 0, this.trayY);
    return n;
  }

  /** 暂存槽里的块排到各自的格子上（skip = 正在飞进来的那块，它自己飞；instant = 重画时直接摆好） */
  private layoutTray(delay: number, skip = -1, instant = false): void {
    this.s.tray.forEach((t, i) => {
      if (t === skip) return;
      const n = this.trayNodes.get(t);
      if (!n || !n.isValid) return;
      const to = new Vec3(this.slotX(i), this.trayY, 0);
      Tween.stopAllByTarget(n);
      if (instant) n.setPosition(to);
      else tween(n).delay(delay).to(0.14, { position: to }, { easing: 'quadOut' }).start();
    });
  }

  private buildSkill(id: string, x: number, y: number): void {
    const S = SKILL_S;
    const node = img(this.stage, 'skin/f_skill', S, S, id);
    at(node, x, y);
    const icon = img(node, `icon/skill_${id}`, 76, 76, 'icon');
    at(icon, 0, 11);
    const name = text(node, skillName(id), 22);
    at(name.node, 0, -37);
    fit(name, S - 8, 22, 15);
    const badge = slice(node, 'kit/tag_red', BADGE_W, BADGE_H, 'badge');
    at(badge, S / 2 - BADGE_W / 2 + 8, S / 2 - 10);
    const count = text(badge, '', 24);
    at(count.node, 0, 2);
    const plus = keyButton(node, 'green', 'kit/ic_plus', 42, null, 0.56);
    at(plus, S / 2 - 12, S / 2 - 10);
    const lock = box('lock', node, S, S);
    at(img(lock, 'kit/ic_lock', 38, 38, 'icon'), 0, 12);
    const lockLabel = text(lock, tr('H_ENTRY_LOCKED', Skills.unlockLevel(App.config.eco, id)), 20);
    at(lockLabel.node, 0, -37);
    fit(lockLabel, S - 8, 22, 14);
    onTap(node, () => Flow.useSkill(this, id));
    this.skillNodes.set(id, { node, icon, count, lock, plus, name: name.node, badge });
  }

  /** 技能键：没解锁灰 + 锁；有库存写数量，免费写「免费」，没有了换绿色加号（点了去买） */
  refreshSkills(): void {
    const save = App.save.data;
    const eco = App.config.eco;
    const lvl = this.arg.daily ? save.level : Math.max(save.level, this.arg.level);
    for (const [id, v] of this.skillNodes) {
      const unlocked = Skills.isUnlocked(eco, id, lvl);
      v.lock.active = !unlocked;
      (v.icon.getComponent(Sprite) as Sprite).grayscale = !unlocked;
      opacity(v.icon).opacity = unlocked ? 255 : 110;
      v.name.active = unlocked;
      const n = Skills.count(save, id);
      const free = this.skillFree(id);
      v.badge.active = unlocked && (n > 0 || free);
      v.plus.active = unlocked && n <= 0 && !free;
      v.count.string = free ? tr('UI_SKILL_FREE') : String(Math.min(n, App.config.ui.badgeCap));
      fit(v.count, SKILL_S - 26, 24, 16);
      const bw = Math.max(BADGE_W, Math.round(textWidth(v.count) + 20));
      resizeSlice(v.badge, bw, BADGE_H);
      at(v.badge, SKILL_S / 2 - bw / 2 + 8, SKILL_S / 2 - 10);
    }
    // 撤销：没得撤销时变灰
    const u = this.skillNodes.get('undo');
    if (u && !u.lock.active) {
      const off = !this.undoSnap;
      (u.icon.getComponent(Sprite) as Sprite).grayscale = off;
      opacity(u.icon).opacity = off ? 120 : 255;
    }
  }

  /** 进度、暂存槽告急（剩 warnFree 格变红闪）、该用道具时技能键发光 + 小手 */
  refreshHud(): void {
    this.progress.set(`${this.total - this.s.left() - this.s.tray.length}/${this.total}`);
    const cfg = App.config.ui.tray;
    const free = this.s.trayCap - this.s.tray.length;
    const playing = this.s.status === Status.PLAYING;
    const warn = playing && free <= cfg.warnFree;
    this.traySlots.forEach((sl, i) => {
      const on = warn && i >= this.s.tray.length;
      setSlice(sl, on ? 'kit/slot_warn' : 'kit/slot');
    });
    const nudge = playing && this.moved && free <= cfg.skillNudgeFree;
    const hand = nudge ? (cfg.nudgeHand.find((id) => this.skillUsable(id)) ?? null) : null;
    this.pointSkill(hand);
    for (const [id, v] of this.skillNodes) {
      const on = nudge && !v.lock.active && cfg.rescueSkills.includes(id);
      if (on && !this.nudged.has(id)) {
        this.nudged.add(id);
        fx.breathe(v.icon, 0.12, 0.6);
      } else if (!on && this.nudged.has(id)) {
        this.nudged.delete(id);
        Tween.stopAllByTarget(v.icon);
        v.icon.setScale(1, 1, 1);
      }
    }
  }

  private skillUsable(id: string): boolean {
    const v = this.skillNodes.get(id);
    if (!v || v.lock.active) return false;
    const why = Skills.canUse(App.save.data, App.config.eco, id, this.used[id] ?? 0, this.freeLevelId, this.usedAll);
    return (why === '' || why === 'empty') && Flow.hasEffect(this, id) === null;
  }

  private pointSkill(id: string | null): void {
    const node = id === null ? null : (this.skillNodes.get(id)?.node ?? null);
    if (this.pointedNode === node) return;
    this.pointedNode?.getChildByName('finger')?.destroy();
    this.pointedNode = node;
    if (node) addFinger(node);
  }

  // ---------------------------------------------------------------- 输入（玩法）

  private tapTile(i: number): void {
    if (this.arg.demo) return;
    this.doTap(i);
  }

  private doTap(i: number): void {
    if (this.ended || this.paused || this.s.status !== Status.PLAYING) return;
    if (this.kindBannerNode) this.dismissKindBanner();
    if (!this.s.free(i)) {
      this.board.blocked(i);
      sfx('error');
      return;
    }
    const snap = this.s.clone();
    const ev = Rules.tap(this.s, i);
    if (ev.length === 0) return;
    this.undoSnap = snap;
    this.clearHint();
    if (!this.moved) {
      this.moved = true;
      Flow.onFirstMove(this);
    }
    this.play(ev);
    this.refreshSkills();
  }

  /** 用道具等改了局面的操作：算出事件并播（道具不能撤销） */
  act(step: () => GameEvent[]): void {
    const ev = step();
    this.undoSnap = null;
    this.play(ev);
    this.refreshSkills();
  }

  /** 玩法：按事件播表现（换玩法时按自己的事件改；命中时调 hitCombo，赢了 celebrate 后 Flow.win，输了 Flow.lose） */
  play(events: GameEvent[]): void {
    const fly = App.config.ui.fly;
    for (const e of events) {
      if (e.type === 'move') {
        const v = this.board.views[e.tile];
        const n = this.trayTile(e.tile);
        if (v) {
          // 从场上那块的位置飞过去
          const p = v.node.worldPosition;
          const local = new Vec3();
          (this.fly.getComponent(UITransform) as UITransform).convertToNodeSpaceAR(p, local);
          n.setPosition(local);
          v.node.active = false;
        }
        this.trayNodes.set(e.tile, n);
        // 插在同图案后面：后面的块往右让一格
        this.layoutTray(0, e.tile);
        sfx('tap');
        tween(n).to(fly.seconds, { position: new Vec3(this.slotX(e.slot), this.trayY, 0) }, { easing: 'quadOut' }).start();
      } else if (e.type === 'clear') {
        const nodes = e.tiles.map((t) => this.trayNodes.get(t)).filter((n): n is Node => !!n);
        for (const t of e.tiles) this.trayNodes.delete(t);
        fx.delay(this.fly, fly.seconds + fly.clearDelay, () => {
          const mx = nodes.reduce((a, n) => a + n.position.x, 0) / Math.max(1, nodes.length);
          for (const n of nodes) {
            tween(n)
              .to(0.12, { position: new Vec3(mx, this.trayY, 0), scale: new Vec3(1.15, 1.15, 1) })
              .call(() => n.destroy())
              .start();
          }
          fx.sparkle(this.fly, mx, this.trayY, 12, 120, COLOR.yellow, 30);
          sfx('pop');
          this.hitCombo(mx);
        });
      } else if (e.type === 'shift') {
        this.layoutTray(fly.seconds + fly.clearDelay + 0.12);
      } else if (e.type === 'shuffle') {
        this.board.reskin(this.s);
      } else if (e.type === 'win') {
        this.ended = true;
        fx.delay(this.fly, fly.seconds + fly.clearDelay + 0.3, () => {
          this.celebrate();
          fx.delay(this.fly, 1.2, () => Flow.win(this));
        });
      } else if (e.type === 'lose') {
        fx.delay(this.fly, fly.seconds + 0.2, () => Flow.lose(this));
      }
    }
    this.board.refresh(this.s);
    this.refreshHud();
  }

  /** 撤销：退回上一步之前的局面，整个重画（连击当场断）。玩法：doTap 里每一步前存了快照 */
  undo(): boolean {
    const snap = this.undoSnap;
    if (!snap) return false;
    snap.clock = this.s.clock;
    this.s = snap;
    this.undoSnap = null;
    this.combo.miss();
    this.setFever(-1, COLOR.white);
    this.layout(false);
    fx.flash(this.fly, Screen.W, Screen.H, 60);
    return true;
  }

  /** 复活等改了局面以后：整个重画 */
  resync(): void {
    this.undoSnap = null;
    this.layout(false);
  }

  /** 提示技能：亮出该点的那一块；没有能点的返回 false */
  showSkillHint(): boolean {
    const i = Rules.hint(this.s);
    if (i < 0) return false;
    this.clearHint();
    this.hintNode = this.board.hint(i);
    return this.hintNode !== null;
  }

  // ---------------------------------------------------------------- 连击（底座：换玩法照用，玩法只管在「命中」时调 hitCombo）

  private hitCombo(x = 0): void {
    const eco = App.config.eco;
    const r = this.combo.hit(this.clock, eco.combo, this.rng, this.arg.daily === true);
    if (this.ended && this.s.status !== Status.WON) return;
    if (r.tier >= 0) sfx('hit', r.count - eco.combo.startAt);
    if (r.count >= 2) buzz('light');
    if (r.tier < 0) {
      this.comboRow.active = false;
      if (r.count >= 2) this.hitPop(`×${r.count}`, 30 + r.count * 4);
      return;
    }
    const col = COMBO_COLORS[r.tier] ?? COLOR.white;
    const was = this.comboRow.active && !this.comboBreaking;
    this.comboBreaking = false;
    this.comboRow.active = true;
    const dw = artNumber(this.comboNum, `×${r.count}`, 88, 'left');
    const groupW = this.comboWordW + 16 + dw;
    at(this.comboWord, -groupW / 2, 0);
    at(this.comboNum, -groupW / 2 + this.comboWordW + 16, 0);
    if (r.coins > 0) {
      const cl = text(null, `+${r.coins}`, 28, { color: COLOR.yellow });
      at(img(cl.node, 'icon/coin', 28, 28, 'coin'), -34, 0);
      fx.floatUp(this.fly, cl.node, groupW / 2 + 50, this.comboY - 10, 26, 0.6);
    }
    if (!was) {
      Tween.stopAllByTarget(this.comboRow);
      Tween.stopAllByTarget(opacity(this.comboRow));
      at(this.comboRow, 0, this.comboY);
      opacity(this.comboRow).opacity = 255;
      fx.popIn(this.comboRow, 0, 0.25);
    }
    // 数字砸下来：放大 2 倍、略歪，回弹到正
    const ln = this.comboNum;
    Tween.stopAllByTarget(ln);
    ln.setScale(2, 2, 1);
    ln.angle = (Math.random() - 0.5) * 8;
    tween(ln).to(0.26, { scale: new Vec3(1, 1, 1), angle: 0 }, { easing: 'backOut' }).start();
    const bd = this.comboBadge;
    Tween.stopAllByTarget(bd);
    bd.setScale(1.14, 1.14, 1);
    tween(bd).to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
    fx.sparkle(this.fly, 0, this.comboY, 6 + Math.min(r.count, 10), 110, col, 28);
    fx.glowPop(this.under, x, this.trayY, 300 + r.tier * 40, col, 0.3, 240);
    fx.ring(this.under, x, this.trayY, 80, 280 + r.tier * 40, col);
    fx.punch(this.stage, 1.008 + r.tier * 0.004);
    this.setFever(r.tier, col);
    this.pulseFrame();
    if (r.tier_up) this.praise(tr(eco.combo.tiers[r.tier].key), r.tier, col);
    if (r.card) Flow.comboCard(this);
  }

  private hitPop(s: string, size0: number): void {
    const n = box('pop', null);
    artNumber(n, s, size0);
    n.angle = (Math.random() - 0.5) * 14;
    fx.floatUp(this.fly, n, 0, this.comboY - 6, 24, 0.5);
  }

  /** 连击满屏的常驻部分：四边光框、放射光、光点，随档位换色；tier < 0 全部收掉 */
  private setFever(tier: number, col: Color): void {
    if (tier === this.comboTier) return;
    this.comboTier = tier;
    this.comboColor = col;
    const fop = opacity(this.frame);
    const rop = opacity(this.feverRays);
    Tween.stopAllByTarget(fop);
    Tween.stopAllByTarget(rop);
    if (tier < 0) {
      this.frameHi = 0;
      tween(fop).to(0.3, { opacity: 0 }).start();
      tween(rop).to(0.4, { opacity: 0 }).start();
      return;
    }
    const f = FEVER[Math.min(tier, FEVER.length - 1)];
    for (const g of this.frame.children) (g.getComponent(Sprite) as Sprite).color = col;
    (this.feverRays.getComponent(Sprite) as Sprite).color = col;
    this.frameHi = f.frame;
    this.breatheFrame();
    tween(rop).to(0.4, { opacity: f.rays }).start();
    Tween.stopAllByTarget(this.feverRays);
    tween(this.feverRays).repeatForever(tween(this.feverRays).by(f.turn, { angle: -360 })).start();
  }

  private breatheFrame(): void {
    const op = opacity(this.frame);
    const hi = this.frameHi;
    const period = 1.1 - Math.max(0, this.comboTier) * 0.18;
    tween(op)
      .to(0.2, { opacity: hi })
      .call(() => {
        tween(op)
          .repeatForever(tween(op).to(period / 2, { opacity: Math.round(hi * 0.6) }).to(period / 2, { opacity: hi }))
          .start();
      })
      .start();
  }

  private pulseFrame(): void {
    if (this.frameHi <= 0) return;
    const op = opacity(this.frame);
    Tween.stopAllByTarget(op);
    op.opacity = 255;
    this.breatheFrame();
  }

  private spawnRise(): void {
    const tier = Math.max(0, this.comboTier);
    const s0 = 22 + Math.random() * 30;
    const n = fxImg(this.under, 'kit/fx_spark', s0, s0, 'rise');
    (n.getComponent(Sprite) as Sprite).color = this.comboColor;
    const x = (Math.random() - 0.5) * Screen.W;
    const y0 = Screen.bottom - 30;
    const y1 = Screen.bottom + Screen.H * (0.55 + Math.random() * 0.5);
    const dur = (1.5 + Math.random() * 0.9) * (1 - tier * 0.1);
    at(n, x, y0);
    const op = opacity(n);
    op.opacity = 235;
    tween(n)
      .to(dur, { position: new Vec3(x + (Math.random() - 0.5) * 90, y1, 0), angle: 200 }, { easing: 'quadOut' })
      .call(() => recycleFx(n))
      .start();
    tween(op).delay(dur * 0.55).to(dur * 0.45, { opacity: 0 }).start();
  }

  private boom(x: number, y: number, col: Color, loud = true, layer: Node = this.fly): void {
    fx.glowPop(layer, x, y, 380, col, 0.3);
    fx.ring(layer, x, y, 60, 420, col);
    fx.ring(layer, x, y, 30, 240, COLOR.white);
    fx.sparkle(layer, x, y, 26, 280, col, 52);
    fx.sparkle(layer, x, y, 12, 140, COLOR.white, 30);
    if (loud) sfx('firework');
  }

  /** 连击升档：夸奖词砸下来（中文用艺术字图），整屏闪、放射光、冲击波、屏幕震、彩纸；高档再放烟花 */
  private praise(word: string, tier: number, col: Color): void {
    const y = (this.fieldTop + this.fieldBottom) / 2;
    if (this.praiseNode?.isValid) this.praiseNode.destroy();
    const meter = opacity(this.comboBadge);
    Tween.stopAllByTag(PRAISE_TAG, meter);
    tween(meter).tag(PRAISE_TAG).to(0.08, { opacity: 0 }).delay(1.05).to(0.2, { opacity: 255 }).start();
    const holder = box('praise', this.fly, 420, 200);
    this.praiseNode = holder;
    at(holder, 0, y);
    const glow = img(holder, 'kit/fx_glow', 380, 200, 'glow');
    (glow.getComponent(Sprite) as Sprite).color = col;
    glow.setScale(0.3, 0.3, 1);
    tween(glow).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    const star = img(holder, 'skin/j_burst', 190, 204, 'burst');
    star.setScale(0.2, 0.2, 1);
    tween(star).to(0.2, { scale: new Vec3(1.1, 1.1, 1) }, { easing: 'quadOut' }).to(0.12, { scale: new Vec3(1, 1, 1) }).start();
    tween(star).by(1.4, { angle: -50 }).start();
    const ww = 290;
    const node =
      language() === 'zh_CN'
        ? img(holder, `skin/j_praise_${tier + 1}`, ww, (ww * (tier === 2 ? 341 : 381)) / 660, 'word')
        : text(holder, word, 68, { color: PRAISE_FILL[tier] ?? COLOR.white, outline: COLOR.navy, outlineWidth: 6 }).node;
    at(node, 0, 6);
    node.setScale(2.4, 2.4, 1);
    node.angle = -8;
    const lop = opacity(node);
    lop.opacity = 0;
    tween(lop).to(0.08, { opacity: 255 }).start();
    tween(node)
      .to(0.15, { scale: new Vec3(0.9, 0.9, 1), angle: 0 }, { easing: 'quadIn' })
      .call(() => this.praiseImpact(y, tier, col))
      .to(0.14, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'quadOut' })
      .to(0.1, { scale: new Vec3(1, 1, 1) })
      .start();
    // 停一下，缩小飞进连击计
    fx.delay(this.fly, 0.9, () => {
      if (!holder.isValid) return;
      fx.flyArc(holder, 0, this.comboY, 0.3, 40, 'quadIn', () => {
        if (holder.isValid) holder.destroy();
        if (!this.comboRow.active) return;
        const bd = this.comboBadge;
        Tween.stopAllByTarget(bd);
        bd.setScale(1.3, 1.3, 1);
        tween(bd).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        fx.sparkle(this.fly, 0, this.comboY, 12, 140, col, 32);
      }, 0.15);
      tween(opacity(holder)).delay(0.14).to(0.16, { opacity: 0 }).start();
    });
    sfx('tier', tier + 1);
  }

  private praiseImpact(y: number, tier: number, col: Color): void {
    const half = Screen.W / 2;
    const reach = Math.hypot(Screen.W, Screen.H);
    buzz(tier >= 2 ? 'heavy' : 'medium');
    fx.trauma(this.stage, 0.5 + tier * 0.12, 20);
    fx.flash(this.under, Screen.W, Screen.H, 90 + tier * 25, col);
    fx.rayBurst(this.under, 0, y, reach * 1.2, col, 0.6, 190);
    fx.ring(this.under, 0, y, 140, reach * 1.1, col, 0.55);
    fx.ring(this.under, 0, y, 100, 620, COLOR.white, 0.4);
    fx.sparkle(this.under, 0, y, 18 + tier * 4, 340, col, 44);
    const n = 16 + tier * 10;
    fx.cannon(this.under, -half - 10, this.fieldBottom - 20, 66, n, 900 + tier * 110);
    fx.cannon(this.under, half + 10, this.fieldBottom - 20, 114, n, 900 + tier * 110);
    const mid = (this.fieldTop + this.fieldBottom) / 2;
    const span = (this.fieldTop - this.fieldBottom) / 2;
    for (let i = 0; i < (tier >= 3 ? 5 : tier >= 2 ? 3 : 0); i++) {
      fx.delay(this.under, 0.12 + i * 0.14, () => {
        this.boom((Math.random() - 0.5) * (Screen.W - 160), mid + (Math.random() - 0.5) * span * 1.4, COMBO_COLORS[(tier + i) % COMBO_COLORS.length], i % 2 === 0, this.under);
      });
    }
  }

  /** 过关庆祝：闪白、放射光、震屏、两角喷彩纸、四发烟花；连击计和满屏收掉 */
  private celebrate(): void {
    this.comboRow.active = false;
    this.setFever(-1, COLOR.white);
    const mid = (this.fieldTop + this.fieldBottom) / 2;
    const half = Screen.W / 2;
    fx.flash(this.fly, Screen.W, Screen.H, 170);
    fx.rayBurst(this.fly, 0, mid, Math.hypot(Screen.W, Screen.H) * 1.2, COLOR.yellow, 0.8, 170);
    fx.ring(this.fly, 0, mid, 140, Screen.H * 1.2, COLOR.white, 0.6);
    fx.trauma(this.stage, 0.6, 20);
    fx.cannon(this.fly, -half - 10, this.fieldBottom - 20, 68, 60, 1250);
    fx.cannon(this.fly, half + 10, this.fieldBottom - 20, 112, 60, 1250);
    const cols = [new Color(255, 214, 64), new Color(110, 215, 255), new Color(255, 120, 200), new Color(140, 255, 120)];
    [[-160, mid + 200], [180, mid + 90], [-40, mid - 60], [150, mid - 220]].forEach(([x, y], i) => {
      fx.delay(this.fly, 0.1 + i * 0.2, () => {
        this.boom(x, y, cols[i]);
        buzz('light');
      });
    });
    buzz('heavy');
  }

  /** 断连：数字变灰，整块抖一下往下掉、淡出 */
  private missCombo(): void {
    const had = this.comboRow.active && !this.comboBreaking;
    this.combo.miss();
    this.setFever(-1, COLOR.white);
    if (!had) return;
    this.comboBreaking = true;
    for (const g of this.comboNum.children) {
      const sp = g.getComponent(Sprite);
      if (sp) sp.grayscale = true;
    }
    const row = this.comboRow;
    Tween.stopAllByTarget(row);
    const y = this.comboY;
    tween(row)
      .to(0.05, { position: new Vec3(-6, y, 0) })
      .to(0.05, { position: new Vec3(6, y, 0) })
      .to(0.05, { position: new Vec3(0, y, 0) })
      .to(0.25, { position: new Vec3(0, y - 24, 0) }, { easing: 'quadIn' })
      .call(() => {
        this.comboBreaking = false;
        row.active = false;
        at(row, 0, y);
        opacity(row).opacity = 255;
      })
      .start();
    const op = opacity(row);
    Tween.stopAllByTarget(op);
    tween(op).delay(0.15).to(0.25, { opacity: 0 }).start();
  }

  // ---------------------------------------------------------------- 每帧

  private update(dt: number): void {
    if (!this.node?.active || !this.s || this.ended) return;
    if (this.paused || ui.currentName !== 'game' || popupCount() > 0) return;
    this.clock += dt;
    // 连击到点就断
    if (this.comboRow.active && !this.comboBreaking && this.clock - this.combo.lastAt > App.config.eco.combo.windowSeconds) this.missCombo();
    if (this.comboTier >= 0) {
      this.riseT += dt * FEVER[Math.min(this.comboTier, FEVER.length - 1)].rise;
      while (this.riseT >= 1) {
        this.riseT -= 1;
        this.spawnRise();
      }
    }
    // 限时关：走第一步才开始走
    if (this.s.status === Status.PLAYING && this.moved) {
      const ev = Rules.tick(this.s, dt);
      if (ev.length) this.play(ev);
      this.syncClock();
    }
    // 闲着不点：亮提示
    this.idle += dt;
    const hint = App.config.ui.hint;
    const wait = this.arg.level <= hint.tutorialLevels ? hint.tutorialSeconds : hint.seconds;
    if (!this.arg.demo && !this.hintNode && !this.tutorNode && this.idle > wait && this.s.status === Status.PLAYING) {
      const i = Rules.hint(this.s);
      if (i >= 0) {
        this.hintNode = this.board.hint(i);
        if (this.hintNode && this.arg.level <= hint.tutorialLevels) addFinger(this.hintNode);
      }
    }
    if (this.tutor && !this.tutorNode) Flow.checkTutorial(this);
    // 玩法：演示（调试页「看路线」）和机器人代打（devtools/autoPlay.ts、./run.sh auto）都按关卡的参考解点：每关一次就过，一直往下打。
    // 代打像真人：每步停顿随机（game_ui.json 的 demo.pause / slow），画面上不出字（录屏、直播用）
    const demo = this.arg.demo === 'route';
    if ((demo || App.flags.autoplay) && this.s.status === Status.PLAYING) {
      this.autoT += dt;
      if (this.autoT > this.autoWait) {
        this.autoT = 0;
        this.autoWait = demo ? App.config.ui.demo.ring + App.config.ui.demo.gap : this.humanPause();
        const i = this.lv.ref[this.demoStep++];
        if (i !== undefined && i >= 0) this.doTap(i);
        else if (demo) Flow.demoStuck(this);
      }
    }
  }

  /** 机器人代打每步停多久：多数时候 pause 秒，偶尔想久一点（slow 秒），像真人在点。录屏（?fast=1）一律 fastPause 秒 */
  private humanPause(): number {
    const d = App.config.ui.demo;
    if (App.flags.fast) return d.fastPause[0] + Math.random() * (d.fastPause[1] - d.fastPause[0]);
    const [a, b] = Math.random() < d.slowChance ? d.slow : d.pause;
    return a + Math.random() * (b - a);
  }

  private syncClock(): void {
    const cap = this.clockCap;
    if (!cap) return;
    const sec = Math.ceil(this.s.clock);
    if (sec === this.clockSecond) return;
    this.clockSecond = sec;
    cap.set(mmss(this.s.clock));
    const warn = this.s.clock <= App.config.ui.clock.warn;
    if (warn) {
      fx.squash(cap.node, 1.12);
      sfx('tick');
    }
    if (warn !== this.clockWarn) {
      this.clockWarn = warn;
      cap.label.color = warn ? COLOR.red : COLOR.white;
    }
  }

  /** 顶栏的关卡号：难关、超难关描边换色，右边挂同色小牌子 */
  private levelTitle(levelName: string, hudY: number, midX: (w: number) => number, timed: boolean): void {
    const kind = this.arg.daily ? 'normal' : levelKind(this.arg.level);
    const lv = text(this.stage, levelName, 30, kind === 'normal' ? {} : { outline: KIND_STYLE[kind].outline });
    const tw = textWidth(lv);
    this.kindTagNode = null;
    if (kind === 'normal') {
      at(lv.node, midX(tw), hudY);
      lv.node.active = !timed;
      return;
    }
    const tag = kindTag(this.stage, kind, 40);
    const tagW = (tag.getComponent(UITransform) as UITransform).width;
    const total = tw + 8 + tagW;
    const x0 = midX(total) - total / 2;
    at(lv.node, x0 + tw / 2, hudY);
    at(tag, x0 + tw + 8 + tagW / 2, hudY);
    lv.node.active = !timed;
    tag.active = !timed;
    this.kindTagNode = tag;
  }

  /** 开局说明看完后：难关、超难关出横幅 */
  showIntro(): void {
    const kind = this.arg.daily || this.arg.demo ? 'normal' : levelKind(this.arg.level);
    if (kind === 'normal' || this.ended) return;
    const b = kindBanner(this.stage, kind);
    this.kindBannerNode = b;
    const y = Screen.H * 0.12;
    at(b, -Screen.W, y);
    sfx('warn');
    const cfg = App.config.ui.kindBanner;
    tween(b)
      .to(cfg.slideIn, { position: new Vec3(0, y, 0) }, { easing: 'backOut' })
      .delay(cfg.hold)
      .call(() => this.dismissKindBanner())
      .start();
  }

  private dismissKindBanner(): void {
    const b = this.kindBannerNode;
    if (!b || !b.isValid) return;
    this.kindBannerNode = null;
    Tween.stopAllByTarget(b);
    const tag = this.kindTagNode;
    const to = tag && tag.isValid && tag.active ? tag.position.clone() : new Vec3(Screen.W, b.position.y, 0);
    tween(b)
      .to(App.config.ui.kindBanner.fly, { position: to, scale: new Vec3(0.2, 0.2, 1) }, { easing: 'quadIn' })
      .call(() => {
        b.destroy();
        if (tag && tag.isValid) fx.squash(tag, 1.2);
      })
      .start();
  }

  /** 新技能教学：压暗全屏，只留这个技能键能点，上方一句「试试新技能」+ 手指 */
  startTutorial(id: string, onUse: () => void): void {
    const v = this.skillNodes.get(id);
    if (!v || this.tutorNode) return;
    this.clearHint();
    const layer = box('tutor', this.stage, Screen.W * 2, Screen.H * 2);
    this.tutorNode = layer;
    const shade = tint(layer, Screen.W * 2, Screen.H * 2, new Color(2, 16, 46, 160), 'shade');
    blockInput(shade);
    opacity(shade).opacity = 0;
    tween(opacity(shade)).to(0.2, { opacity: 255 }).start();
    const p = v.node.position;
    const ring = img(layer, 'kit/fx_ring', 190, 190, 'ring');
    (ring.getComponent(Sprite) as Sprite).color = new Color(255, 243, 107, 255);
    at(ring, p.x, p.y);
    fx.breathe(ring, 0.1, 0.8);
    const copy = img(layer, 'skin/f_skill', SKILL_S, SKILL_S, 'copy');
    at(copy, p.x, p.y);
    at(img(copy, `icon/skill_${id}`, 76, 76, 'icon'), 0, 11);
    onTap(copy, () => {
      this.endTutorial();
      onUse();
    });
    const tip = text(layer, tr('UI_SKILL_TRY', skillName(id)), 40, { color: COLOR.yellow });
    at(tip.node, 0, p.y + 190);
    fx.popIn(tip.node, 0.1, 0.25);
    addFinger(copy);
    sfx('unlock');
  }

  endTutorial(): void {
    this.tutor = '';
    this.tutorNode?.destroy();
    this.tutorNode = null;
  }

  private clearHint(): void {
    this.idle = 0;
    this.hintNode?.destroy();
    this.hintNode = null;
  }

  /** 特效层（流程里飘字用） */
  fxLayer(): Node {
    return this.fly;
  }
}

/** 引导手指：指着目标上下点 */
function addFinger(target: Node): void {
  const f = img(target, 'skin/j_finger', 84, 120, 'finger');
  const x = 42 - 0.3 * 84;
  const y = -60 - 20;
  at(f, x + 6, y);
  f.angle = 18;
  tween(f)
    .repeatForever(
      tween(f)
        .to(0.35, { position: new Vec3(x + 6, y + 18, 0), scale: new Vec3(0.92, 0.92, 1) }, { easing: 'quadOut' })
        .to(0.35, { position: new Vec3(x + 6, y, 0), scale: new Vec3(1, 1, 1) }, { easing: 'quadIn' }),
    )
    .start();
}
