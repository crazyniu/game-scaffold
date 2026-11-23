// 各页共用的弹窗：恭喜获得 / 十连、金币不足、离开确认、生命、设置 / 暂停、新收藏卡翻面、看广告。
// 版式见 docs/09。
import { Color, Label, Node, Sprite, Vec3, tween, UITransform } from 'cc';
import type { CardResult, Prize } from '../core/meta/save';
import type { AdResult } from '../platform/platformBase';
import * as Cards from '../core/meta/cards';
import * as Lives from '../core/meta/lives';
import * as Meta from '../core/meta/meta';
import * as Tasks from '../core/meta/tasks';
import { App } from '../services/app';
import { buzz, applySettings, sfx } from '../services/audio';
import { adNow, now, today } from '../services/clock';
import * as fx from './fx';
import { LANGUAGE_NAMES, language, setLanguage, tr } from './i18n';
import { at, box, button, COLOR, DARK_INK, fit, fmt, hex, img, INK, onTap, opacity, setImg, setInk, slice, text, textWidth, twoLines } from './kit';

/** 语言选择里没选中那一段的字色 */
const SEG_DIM = hex('#5E86C0');
import { openPopup, Popup } from './popup';
import { fontFor, loadFont, uiFont } from './res';
import { Screen } from './screen';
import { ui } from './shell';
import { lab } from '../devtools/levelLab';
import * as TestMode from '../devtools/testMode';

// ---------------------------------------------------------------- 看广告

/** 看激励视频。看完返回 true；没看完、不可用返回 false（不可用时提示，docs/01） */
export async function watchAd(placement: string): Promise<boolean> {
  if (!App.platform.adsAvailable()) {
    ui.toast(tr('UI_AD_UNAVAILABLE'));
    return false;
  }
  ui.busy(true);
  let r: AdResult = 'unavailable';
  try {
    r = await App.platform.showRewarded(placement);
  } catch (e) {
    // 广告接口抛错：按不可用，遮罩一定要撤（不然复活、翻倍等入口一直被挡着）
    console.warn('激励视频出错', e);
  } finally {
    ui.busy(false);
  }
  if (r === 'done') {
    Meta.markRewarded(App.save.data, adNow());
    Tasks.add(App.save.data, App.config.eco, today(), 'ad');
    App.platform.track('ad_rewarded', { placement });
    return true;
  }
  if (r === 'unavailable') ui.toast(tr('UI_AD_UNAVAILABLE'));
  return false;
}

// ---------------------------------------------------------------- 奖品

export interface PrizeItem {
  icon: string;
  amount: string;
  /** 单个开奖时写在数量前面（金币 ×100） */
  name?: string;
  /** 收藏卡：稀有度框 */
  rarity?: string;
}

/** 卡名走多语言（cards.json 里的 name 只是中文备注）：文案键 CARD_<id> */
export function cardName(id: string): string {
  return tr(`CARD_${id.toUpperCase()}`);
}

export function skillName(id: string): string {
  return tr(`H_SKILL_${id.toUpperCase()}`);
}

export function skillIcon(id: string): string {
  return `icon/skill_${id}`;
}

export function prizeItems(prizes: Prize[]): PrizeItem[] {
  const out: PrizeItem[] = [];
  for (const p of prizes) {
    if (p.kind === 'coin') out.push({ icon: 'icon/coin', amount: String(p.amount), name: tr('PRIZE_COINS') });
    else if (p.kind === 'skill') out.push({ icon: skillIcon(p.skill ?? 'shuffle'), amount: `×${p.amount ?? 1}`, name: skillName(p.skill ?? 'shuffle') });
    else if (p.kind === 'inf_life') out.push({ icon: 'icon/heart_inf', amount: tr('UI_MINUTES', p.amount ?? 0) });
    else if (p.kind === 'frame') out.push({ icon: 'kit/fx_ring', amount: tr('H_PRIZE_FRAME') });
    else if (p.kind === 'card' && p.card_id) out.push({ icon: `card/${p.card_id}`, amount: tr(`UI_RARITY_${(p.rarity ?? 'common').toUpperCase()}`), rarity: p.rarity, name: cardName(p.card_id) });
  }
  return out;
}

export function cardItem(c: CardResult): PrizeItem {
  return { icon: `card/${c.id}`, amount: tr(`UI_RARITY_${c.rarity.toUpperCase()}`), rarity: c.rarity, name: cardName(c.id) };
}

/**
 * 收藏卡的小卡框（Codex 画的，tools/art/cards_icons.py 切出来）：只有一个大窗口，没有名字白条
 * （奖品里的卡下面那条空白条不要）。aspect = 高 / 宽；win = 窗口的 左、上、右、下（占卡宽高的比例）。
 * 越稀有框越华丽、顶上的装饰越高，所以各张的高不一样
 */
const CARD_FRAME: Record<string, { aspect: number; win: [number, number, number, number] }> = {
  common: { aspect: 495 / 360, win: [0.069, 0.085, 0.928, 0.919] },
  uncommon: { aspect: 531 / 360, win: [0.075, 0.164, 0.922, 0.925] },
  rare: { aspect: 508 / 360, win: [0.083, 0.114, 0.919, 0.919] },
  epic: { aspect: 559 / 360, win: [0.083, 0.199, 0.917, 0.928] },
  legend: { aspect: 557 / 360, win: [0.078, 0.235, 0.919, 0.88] },
};

/**
 * 一张小卡：卡框 + 窗口里的卡面图。返回卡的节点，原点在卡的**下沿中点**，
 * 这样不同稀有度的卡排成一排时底边对齐（上面的装饰高低不同）
 */
export function miniCard(parent: Node, id: string, rarity: string, w: number, name = 'card'): Node {
  const f = CARD_FRAME[rarity] ?? CARD_FRAME.common;
  const h = w * f.aspect;
  const n = box(name, parent, w, h);
  const frame = img(n, `skin/j_card_${rarity in CARD_FRAME ? rarity : 'common'}`, w, h, 'frame');
  at(frame, 0, h / 2);
  const [l, t, r, b] = f.win;
  const size = Math.min(w * (r - l), h * (b - t)) * 0.86;
  const art = img(n, `card/${id}`, size, size, 'art');
  at(art, w * ((l + r) / 2 - 0.5), h * (1 - (t + b) / 2));
  return n;
}

/** 普通卡的高 / 宽（排版按它留高度，更华丽的卡顶上的装饰可以略高出一点） */
export const CARD_ASPECT = 495 / 360;

/**
 * 一个奖品格：图标 + 数量。收藏卡是一张 Codex 画的小卡（稀有度框，窗口里是生物，没有名字白条），
 * 稀有度写在卡下面、不压在卡上
 */
export function prizeCell(parent: Node, it: PrizeItem, s = 110): Node {
  if (it.rarity) {
    const fw = s * 0.82;
    const fh = fw * CARD_ASPECT;
    const fs = Math.max(22, Math.round(s * 0.2));
    const n = box('prize', parent, s, fh + fs + 10);
    const bottom = -(fh + fs + 10) / 2 + fs + 10;
    const cid = it.icon.startsWith('card/') ? it.icon.slice(5) : '';
    const card = miniCard(n, cid, it.rarity, fw);
    at(card, 0, bottom);
    const l = text(n, it.amount, fs);
    at(l.node, 0, bottom - 6 - fs / 2);
    return n;
  }
  const n = box('prize', parent, s, s + 40);
  const icon = img(n, it.icon, s * 0.86, s * 0.86, 'icon');
  at(icon, 0, 16);
  const l = text(n, it.amount, Math.max(28, Math.round(s * 0.28)));
  at(l.node, 0, -s / 2 - 8);
  return n;
}

/** 恭喜获得（一个奖品大图）或一组奖品（十连、宝箱）。extra：签到等场景多一个看广告翻倍按钮 */
export function rewardPopup(
  items: PrizeItem[],
  o: { title?: string; onClose?: () => void; double?: { label: string; onTap: () => void } } = {},
): Popup {
  const many = items.length > 1;
  const cols = items.length <= 4 ? items.length : 5;
  const rows = Math.ceil(items.length / cols);
  // 标题放在弹窗统一的标题栏里；内容区自上而下：奖品 → 名称数量 → 按钮
  const dbl = o.double ? 115 : 0;
  const h = many ? 64 + rows * 196 + 32 + 110 + 32 + dbl : 480 + dbl;
  const p = openPopup({ w: 640, h, title: o.title ?? tr('H_CONGRATS'), noClose: true, onClose: o.onClose });
  if (!many && items[0]) {
    const iy = h / 2 - 32 - 110;
    const glow = fx.rays(p.body, 360);
    at(glow, 0, iy);
    const it = items[0];
    const icon = it.rarity ? prizeCell(p.body, it, 220) : img(p.body, it.icon, 220, 220, 'icon');
    at(icon, 0, iy);
    fx.popIn(icon, 0.15, 0.35);
    fx.sparkle(p.body, 0, iy, 10, 160, COLOR.yellow);
    if (!it.rarity) {
      const l = text(p.body, it.name ? `${it.name} ${it.amount.startsWith('×') ? it.amount : `×${it.amount}`}` : it.amount, 44);
      at(l.node, 0, iy - 146);
    }
  } else {
    const cw = cols >= 5 ? 116 : 150;
    items.forEach((it, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const inRow = Math.min(cols, items.length - r * cols);
      const cell = prizeCell(p.body, it, cols >= 5 ? 104 : 128);
      at(cell, (c - (inRow - 1) / 2) * cw, h / 2 - 32 - 88 - r * 196);
      fx.popIn(cell, 0.1 + i * 0.07, 0.25);
    });
  }
  let y = -h / 2 + 32 + 55;
  const take = button(p.body, { color: 'green', w: 420, h: 110, label: tr('UI_CLAIM'), fontSize: 48, onTap: () => p.close() });
  at(take.node, 0, y);
  if (o.double) {
    y += 115;
    const d = o.double;
    const db = button(p.body, { color: 'yellow', w: 400, h: 96, label: d.label, icon: 'kit/ic_video', onTap: () => (p.close(), d.onTap()) });
    at(db.node, 0, y);
  }
  sfx('chest');
  return p;
}

// ---------------------------------------------------------------- 金币不足

/** 还差多少金币；主按钮「看广告领 N 金币」，次数用完或广告不可用时只给一行提示（docs/01） */
export function needCoins(short: number, after?: () => void): void {
  const eco = App.config.eco;
  const p = openPopup({ w: 600, h: 520, title: tr('H_NEED_COINS'), mascot: null });
  const coins = img(p.body, 'icon/coin', 180, 180, 'coins');
  at(coins, 0, 90);
  fx.rays(p.body, 300).setSiblingIndex(0);
  const l = text(p.body, tr('H_NEED_COINS_LINE', short), 40);
  at(l.node, 0, -40);
  const left = Meta.freeCoinLeft(App.save.data, eco, today());
  if (left > 0 && App.platform.adsAvailable()) {
    const b = button(p.body, {
      color: 'yellow',
      w: 480,
      h: 100,
      icon: 'kit/ic_video',
      label: tr('H_WATCH_COINS', eco.freeCoin.amount),
      fontSize: 36,
      onTap: async () => {
        if (!(await watchAd('rv_free_coin'))) return;
        Meta.takeFreeCoin(App.save.data, eco, today());
        App.save.write();
        p.close();
        sfx('coins');
        ui.refresh();
        after?.();
      },
    });
    at(b.node, 0, -160);
  } else {
    const t = text(p.body, tr('UI_NO_COINS'), 32);
    at(t.node, 0, -160);
  }
}

/** 花金币前先问够不够：够返回 true（不扣，扣钱由调用方或 core 的 buy 做一次）；不够弹「金币不足」 */
export function spend(cost: number): boolean {
  const s = App.save.data;
  if (s.coins >= cost) return true;
  needCoins(cost - s.coins);
  return false;
}

// ---------------------------------------------------------------- 离开确认

export function confirmLeave(onLeave: () => void): void {
  const p = openPopup({ w: 600, h: 528, title: tr('H_LEAVE_TITLE') });
  const heart = img(p.body, 'icon/heart', 140, 140, 'heart');
  at(heart, -50, 120);
  const minus = text(p.body, '-1', 80, { color: hex('#E8473A') });
  at(minus.node, 80, 120);
  const line = text(p.body, tr('H_LEAVE_LINE'), 32);
  at(line.node, 0, 10);
  const keep = button(p.body, { color: 'green', w: 440, h: 100, label: tr('H_KEEP_PLAYING'), fontSize: 40, onTap: () => p.close() });
  at(keep.node, 0, -84);
  const leave = button(p.body, { color: 'blue', w: 440, h: 88, label: tr('H_LEAVE'), fontSize: 34, onTap: () => (p.close(), onLeave()) });
  at(leave.node, 0, -190);
}

// ---------------------------------------------------------------- 生命

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/**
 * 生命弹窗：五颗心、一行恢复倒计时，下面四个一样大的按钮排成两行——看广告 +1、分享 +1、金币买 1 条、金币补满。
 * 按钮上只写结果（+1、补满）和代价（剩几次、多少金币），不写长句
 */
export function livesPopup(onChange?: () => void): void {
  const eco = App.config.eco;
  const s = App.save.data;
  const day = today();
  const adLeft = Lives.adLeft(s, eco, day);
  const adOn = adLeft > 0 && App.platform.adsAvailable();
  // 按钮两个一行：有看广告那个是三个、两行；没有（第一版不接广告）只有一行，弹窗跟着矮一截（底下空太多）
  const rows = adOn ? 2 : 1;
  const ROW_H = 112;
  const ROW_G = 16;
  const popH = 402 + (rows - 1) * (ROW_H + ROW_G);
  const top = popH / 2;
  const p = openPopup({ w: 620, h: popH, title: tr('H_LIVES_TITLE') });
  const hearts: Node[] = [];
  for (let i = 0; i < eco.lives.max; i++) {
    const h = img(p.body, 'icon/heart', 92, 92, 'heart');
    at(h, (i - (eco.lives.max - 1) / 2) * 102, top - 89);
    hearts.push(h);
  }
  const pill = slice(p.body, 'kit/row', 380, 68, 'timer');
  at(pill, 0, top - 183);
  const tIcon = img(pill, 'kit/ic_timer', 40, 40, 'icon');
  const tLabel = text(pill, '', 32);
  const refresh = () => {
    const t = now();
    const n = Lives.count(s, eco, t);
    hearts.forEach((h, i) => ((h.getComponent(Sprite) as Sprite).grayscale = i >= n));
    const inf = Lives.isUnlimited(s, t);
    const full = !inf && n >= eco.lives.max;
    tLabel.string = inf ? tr('H_INF_LEFT', mmss(Lives.unlimitedLeft(s, t))) : full ? tr('H_LIVES_FULL') : tr('H_NEXT_LIFE', mmss(Lives.secondsToNext(s, eco, t)));
    fit(tLabel, 380 - 100, 32, 20);
    // 图标 + 字一起居中；满了就只有字
    tIcon.active = !full;
    const w = textWidth(tLabel);
    at(tIcon, -w / 2 - 6, 0);
    at(tLabel.node, full ? 0 : 22, 0);
  };
  refresh();
  tween(p.body)
    .repeatForever(tween(p.body).delay(1).call(refresh))
    .start();
  const changed = () => {
    App.save.write();
    sfx('coin');
    refresh();
    ui.refresh();
    onChange?.();
  };
  const isFull = () => Lives.count(s, eco, now()) >= eco.lives.max;
  // [颜色, 主文字, 主文字前的图标, 小字, 小字前的图标, 能不能点, 点了做什么]
  type Opt = { color: 'yellow' | 'blue' | 'green'; main: string; mainIcon: string | null; sub: string; subIcon: string | null; on: boolean; tap: () => void };
  const opts: Opt[] = [];
  if (adOn) {
    opts.push({
      color: 'yellow',
      main: '+1',
      mainIcon: 'kit/ic_video',
      sub: tr('ADS_LEFT', adLeft),
      subIcon: null,
      on: true,
      tap: async () => {
        if (isFull()) return ui.toast(tr('H_LIVES_FULL'));
        if (!(await watchAd('rv_life'))) return;
        // 看广告的这会儿自然回满了：不加也不扣次数，如实说已满
        if (!Lives.claimAd(s, eco, today(), now())) {
          refresh();
          return ui.toast(tr('H_LIVES_FULL'));
        }
        changed();
      },
    });
  }
  opts.push({
    color: 'blue',
    main: '+1',
    mainIcon: 'icon/heart',
    sub: fmt(eco.lives.buyOneCoins),
    subIcon: 'icon/coin',
    on: true,
    tap: () => {
      if (isFull()) return ui.toast(tr('H_LIVES_FULL'));
      if (!spend(eco.lives.buyOneCoins)) return;
      Lives.buyOne(s, eco, now());
      changed();
    },
  });
  opts.push({
    color: 'green',
    main: tr('H_REFILL'),
    mainIcon: null,
    sub: fmt(eco.lives.refillCoins),
    subIcon: 'icon/coin',
    on: true,
    tap: () => {
      if (isFull()) return ui.toast(tr('H_LIVES_FULL'));
      if (!spend(eco.lives.refillCoins)) return;
      Lives.buyRefill(s, eco, now());
      changed();
    },
  });
  // 两个一行；只有三个时第一个占一整行
  const W = 270;
  const H = ROW_H;
  const G = ROW_G;
  let y = top - 293;
  let i = 0;
  while (i < opts.length) {
    const wide = (opts.length - i) % 2 === 1;
    const row = wide ? [opts[i]] : [opts[i], opts[i + 1]];
    row.forEach((o, k) => {
      const b = button(p.body, { color: o.color, w: wide ? W * 2 + G : W, h: H, onTap: () => void o.tap() });
      at(b.node, wide ? 0 : (k - 0.5) * (W + G), y);
      twoLines(b, o.main, o.sub, o.subIcon, o.mainIcon);
      b.setEnabled(o.on);
    });
    i += row.length;
    y -= H + G;
  }
}

// ---------------------------------------------------------------- 道具礼包（docs/01）

/** 第一次过了礼包关：每种道具各送几个，并告诉玩家从下一关起道具要用库存或金币了。关掉后接着 onDone */
export function giftPopup(ids: string[], count: number, onDone: () => void): void {
  const p = openPopup({ w: 620, h: 470, title: tr('GIFT_TITLE'), onClose: onDone });
  ids.forEach((id, i) => {
    const icon = img(p.body, `icon/skill_${id}`, 110, 110, 'icon');
    at(icon, (i - (ids.length - 1) / 2) * 130, 100);
    at(text(icon, `×${count}`, 32).node, 34, -44);
  });
  const line = text(p.body, tr('GIFT_LINE'), 30, { width: 540 });
  at(line.node, 0, -30);
  const ok = button(p.body, { color: 'green', w: 300, h: 100, label: tr('GOT_IT'), onTap: () => p.close() });
  // 机器人代打：没人点，看一眼就自己关
  if (App.flags.autoplay) fx.delay(p.body, 1.5, () => p.close());
  at(ok.node, 0, -150);
  sfx('coin');
}

// ---------------------------------------------------------------- 设置 / 暂停

/** 主页打开 = 设置：三个开关 + 语言；局内打开 = 暂停：三个开关 +「回主页」「重试」（docs/09） */
/** 两段切换键上的短名字（「简体中文」放不下） */
const SEG_NAME: Record<string, string> = { zh_CN: '中文', en: 'English' };

/** 换语言：先读好这种语言的字体，再换文案（换文案会重画整个界面、关掉弹窗），记进存档 */
export async function switchLanguage(lang: string): Promise<void> {
  if (lang === language()) return;
  try {
    await loadFont(lang);
  } catch (e) {
    console.warn('字体读不出来', e);
  }
  App.save.data.settings.lang = lang;
  App.save.write();
  setLanguage(lang);
}

/** 语言列表：两列，每种语言用它自己的文字写，当前的那个是绿色 */
function languagePopup(): void {
  const langs = App.platform.languages;
  const rows = Math.ceil(langs.length / 2);
  const bw = 262;
  const bh = 84;
  const gap = 16;
  // 上留 76（标题牌压着弹窗上沿那一截）、下留 48
  const h = rows * (bh + gap) - gap + 76 + 48;
  const p = openPopup({ w: 620, h, title: tr('H_LANGUAGE') });
  langs.forEach((c, i) => {
    const col = i % 2;
    const r = Math.floor(i / 2);
    const b = button(p.body, {
      color: c === language() ? 'green' : 'blue',
      w: bw,
      h: bh,
      label: LANGUAGE_NAMES[c] ?? c,
      fontSize: 32,
      onTap: () => {
        p.close();
        void switchLanguage(c);
      },
    });
    // 自称用那种语言自己的字体写：游戏字体没有韩文，韩文字体没有简体字和西里尔字母，各用各的
    void fontFor(c)
      .then((f) => {
        const lb = b.label;
        if (f !== uiFont() && lb?.node.isValid) lb.font = f;
      })
      .catch(() => undefined);
    at(b.node, (col - 0.5) * (bw + gap), h / 2 - 76 - r * (bh + gap) - bh / 2);
  });
}

export function settingsPopup(mode: 'home' | 'pause', o: { onHome?: () => void; onRetry?: () => void; onClose?: () => void } = {}): void {
  const s = App.save.data;
  // 测试用的按钮（广告测试、难度调试 · 机器人代打）只在测试模式里出（devtools/testMode.ts：设置标题 10 秒内连点 10 下，上架包也能开）
  const test = mode === 'home' && TestMode.isOn();
  const adTest = test && App.platform.hasCapability('ad_test');
  const labOn = test && lab.enabled;
  const extra = (adTest ? 112 : 0) + (App.platform.hasCapability('privacy_options') ? 112 : 0) + (App.platform.hasCapability('privacy_policy') ? 112 : 0) + (labOn ? 112 : 0);
  const h = mode === 'pause' ? 528 : 512 + extra;
  const p = openPopup({ w: 620, h, title: tr(mode === 'pause' ? 'PAUSE_TITLE' : 'UI_SETTINGS'), onClose: o.onClose });
  // 隐藏入口：标题「设置」10 秒内连点 10 下打开测试模式（再连点 10 下关上），重开设置就出（或收起）测试按钮，不弹任何字。点着没声音、不缩放，看不出能点
  const titleBar = mode === 'home' ? p.body.getChildByName('title') : null;
  if (titleBar) {
    onTap(
      titleBar,
      () => {
        if (!TestMode.tap(Date.now())) return;
        // 开着再连点 10 下就关上；不出任何字，别人看不出有这回事
        TestMode.set(!TestMode.isOn());
        p.close();
        settingsPopup(mode, o);
      },
      { press: 0, sound: null },
    );
  }
  const rows: [string, string, keyof typeof s.settings][] = [
    ['kit/ic_music', 'H_MUSIC', 'music'],
    ['kit/ic_sound', 'H_SOUND', 'sound'],
    ['kit/ic_vibrate', 'H_VIBRATION', 'vibrate'],
  ];
  let y = h / 2 - 32 - 48;
  for (const [icon, key, field] of rows) {
    const row = slice(p.body, 'kit/row', 556, 96, 'row');
    at(row, 0, y);
    const ic = img(row, icon, 48, 48, 'icon');
    at(ic, -556 / 2 + 24 + 24, 0);
    const l = text(row, tr(key), 32, { align: 'left' });
    at(l.node, -556 / 2 + 96, 0);
    const tg = img(row, s.settings[field] ? 'skin/f_toggle_on' : 'skin/f_toggle_off', 116, 55, 'toggle');
    at(tg, 196, 0);
    onTap(
      row,
      () => {
        (s.settings as unknown as Record<string, boolean>)[field] = !s.settings[field];
        const on = s.settings[field];
        setImg(tg, on ? 'skin/f_toggle_on' : 'skin/f_toggle_off', 116, 55);
        // 开 = 两个音往上，关 = 两个音往下；开关把手顿一下；打开震动时震一下让人知道是什么手感
        sfx(on ? 'toggleOn' : 'toggleOff');
        fx.squash(tg, 0.88);
        if (field === 'vibrate' && on) buzz('medium');
        App.save.write();
        applySettings();
      },
      { sound: null },
    );
    y -= 96 + 16;
  }
  if (mode === 'home') {
    const row = slice(p.body, 'kit/row', 556, 96, 'lang');
    at(row, 0, y);
    const ic = img(row, 'kit/ic_globe', 48, 48, 'icon');
    at(ic, -556 / 2 + 48, 0);
    const l = text(row, tr('H_LANGUAGE'), 32, { align: 'left' });
    at(l.node, -556 / 2 + 96, 0);
    const langs = App.platform.languages;
    if (langs.length === 2) {
      // 只有两种语言（微信：简体、英文）：一个两段的切换键
      const seg = slice(row, 'kit/seg_bg', 256, 64, 'seg');
      at(seg, 556 / 2 - 16 - 128, 0);
      const on = slice(seg, 'kit/seg_on', 128, 64, 'on');
      const names = langs.map((c, i) => {
        const t = text(seg, SEG_NAME[c] ?? LANGUAGE_NAMES[c] ?? c, 26);
        at(t.node, i === 0 ? -64 : 64, 2);
        return t;
      });
      const place = () => {
        const first = language() === langs[0];
        at(on, first ? -64 : 64, 0);
        // 深色凹槽里，选中的一段是蓝色果冻；没选中的字淡一点
        names[0].color = first ? COLOR.white : SEG_DIM;
        names[1].color = first ? SEG_DIM : COLOR.white;
      };
      place();
      onTap(seg, () => void switchLanguage(language() === langs[0] ? langs[1] : langs[0]));
    } else {
      // 语言多（App）：右边写当前语言，点了弹语言列表
      const cur = text(row, `${LANGUAGE_NAMES[language()] ?? language()}  ›`, 30, { align: 'right' });
      at(cur.node, 556 / 2 - 28, 0);
      onTap(row, () => languagePopup());
    }
    y -= 96 + 16;
    // 隐私政策：不管有没有广告都要能打开（苹果 5.1.1、Google Play 用户数据政策，docs/06 第 1 节）
    if (App.platform.hasCapability('privacy_policy')) {
      const b = button(p.body, { color: 'blue', w: 556, h: 88, label: tr('UI_PRIVACY_POLICY'), fontSize: 32, onTap: () => App.platform.openPrivacyPolicy() });
      at(b.node, 0, y - 8);
      y -= 112;
    }
    // 广告的隐私选项（欧洲等地要能随时改同意，docs/10 第 5 节）
    if (App.platform.hasCapability('privacy_options')) {
      const b = button(p.body, { color: 'blue', w: 556, h: 88, label: tr('UI_PRIVACY_OPTIONS'), fontSize: 32, onTap: () => App.platform.openPrivacyOptions() });
      at(b.node, 0, y - 8);
      y -= 112;
    }
    if (adTest) {
      const b = button(p.body, { color: 'blue', w: 556, h: 88, label: tr('UI_AD_TEST'), fontSize: 32, onTap: () => (p.close(), ui.go('adtest')) });
      at(b.node, 0, y - 8);
      y -= 112;
    }
    // 难度调试页（测试模式才有，devtools/；调试用，字直接写）：看路线、试玩、机器人代打（从这关起）都在里面
    if (labOn) {
      const b = button(p.body, { color: 'blue', w: 556, h: 88, label: '难度调试 · 机器人代打', fontSize: 32, onTap: () => (p.close(), ui.go('lab')) });
      at(b.node, 0, y - 8);
    }
  } else {
    const home = button(p.body, { color: 'blue', w: 270, h: 112, label: tr('H_TO_HOME'), fontSize: 40, onTap: () => (p.close(), o.onHome?.()) });
    at(home.node, -143, y - 24);
    const retry = button(p.body, { color: 'green', w: 270, h: 112, label: tr('H_RETRY'), fontSize: 40, onTap: () => (p.close(), o.onRetry?.()) });
    at(retry.node, 143, y - 24);
  }
}

// ---------------------------------------------------------------- 新收藏卡

export const RARITY_GLOW: Record<string, Color> = {
  common: new Color(220, 230, 245),
  uncommon: new Color(140, 240, 110),
  rare: new Color(110, 190, 255),
  epic: new Color(210, 140, 255),
  legend: new Color(255, 214, 64),
};

/**
 * 新收藏卡亮相：卡背朝上弹出 → 翻面 → 正面 + 稀有度光圈；史诗、传说加金光、火花、彩纸和全屏闪；
 * 卡翻完才能点击继续。重复卡写「已拥有，换 N 金币」。多张依次翻
 */
export function revealCards(cards: CardResult[], done?: () => void): void {
  if (cards.length === 0) {
    done?.();
    return;
  }
  const [c, ...rest] = cards;
  const p = openPopup({ w: Screen.W, h: Screen.H, noClose: true, mascot: null, onClose: () => revealCards(rest, done) });
  const panel = p.body.getChildByName('frame');
  if (panel) panel.active = false;
  // 没有卡片底板：字直接压在压暗的背景上，用白字深描边
  setInk(p.body, DARK_INK);
  // 亮卡是全屏时刻：背景压得更暗，下面的按钮、文字不抢眼
  const dim = p.root.getChildByName('dim')?.getComponent(Sprite);
  if (dim) dim.color = new Color(0, 14, 44, 225);
  const epic = Cards.rank(App.config.eco, c.rarity) >= 3;
  const glow = fx.rays(p.body, 620);
  (glow.getComponent(Sprite) as Sprite).color = RARITY_GLOW[c.rarity] ?? COLOR.white;
  opacity(glow).opacity = 0;
  const card = box('card', p.body, 380, 508);
  at(card, 0, 60);
  const back = img(card, 'icon/card_back', 370, 508, 'back');
  const front = box('front', card, 380, 508);
  img(front, `skin/f_card_${c.rarity}`, 380, 508, 'frame');
  const art = img(front, `card/${c.id}`, 270, 270, 'art');
  at(art, 0, 64);
  fx.bob(art, 6, 2.2);
  const sp = App.config.cardById.get(c.id);
  // 名字在卡框下面那条浅色名字条上：深蓝字、不描边
  const name = text(front, sp ? cardName(sp.id) : c.id, 40, { color: INK.ink, outline: null, shadow: false });
  at(name.node, 0, -160);
  // 名字条宽 293：生物名都放得下，不缩字
  fit(name, 270, 40, 24);
  // 稀有度写在卡片上面（放下面挤着「已自动换成」那一行），翻完才出来
  const rar = text(p.body, tr(`UI_RARITY_${c.rarity.toUpperCase()}`), 44, { color: RARITY_GLOW[c.rarity] });
  at(rar.node, 0, 60 + 254 + 50);
  rar.node.active = false;
  front.active = false;
  // 新卡写「新收藏！」；重复卡是自动换成金币的（docs/01），写清楚「已自动换成」+ 金币图标和数量，不让人以为要自己去换
  const lineY = 60 - 254 - 56;
  const line = text(p.body, c.is_new ? tr('CARD_RARITY_NEW') : tr('UI_CARD_OWNED'), c.is_new ? 40 : 34);
  at(line.node, 0, lineY);
  if (!c.is_new) {
    line.updateRenderData(true);
    const tw = (line.node.getComponent(UITransform) as UITransform).width;
    const amount = text(line.node, `+${c.coins}`, 44, { color: COLOR.yellow, align: 'left' });
    amount.updateRenderData(true);
    const aw = (amount.node.getComponent(UITransform) as UITransform).width;
    // 一行：文字 · 金币图标 · +N，整体居中
    const total = tw + 14 + 48 + 8 + aw;
    at(line.node, -total / 2 + tw / 2, lineY);
    at(img(line.node, 'icon/coin', 48, 48, 'coin'), tw / 2 + 14 + 24, 0);
    at(amount.node, tw / 2 + 14 + 48 + 8, 0);
  }
  line.node.active = false;
  // 「继续」是个按钮（原来是一行「点击继续」的字）；翻完才出来
  const cont = button(p.body, { color: 'green', w: 300, h: 92, label: tr('TAP_CONTINUE'), onTap: () => ready && p.close() });
  at(cont.node, 0, lineY - 110);
  cont.node.active = false;
  let ready = false;
  fx.popIn(card, 0.05, 0.35);
  sfx('card');
  tween(card)
    .delay(0.6)
    .to(0.18, { scale: new Vec3(0.02, 1.05, 1) }, { easing: 'quadIn' })
    .call(() => {
      back.active = false;
      front.active = true;
      tween(opacity(glow)).to(0.25, { opacity: 255 }).start();
      if (epic) {
        fx.flash(p.root, Screen.W, Screen.H, 200, RARITY_GLOW[c.rarity]);
        fx.confetti(p.root, 0, 200, 60, 420);
        buzz('medium');
      }
      fx.sparkle(p.body, 0, 60, epic ? 20 : 10, 280, RARITY_GLOW[c.rarity], epic ? 48 : 34);
      sfx(epic ? 'firework' : 'star');
    })
    .to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
    .call(() => {
      line.node.active = true;
      rar.node.active = true;
      cont.node.active = true;
      fx.popIn(cont.node, 0, 0.25);
      ready = true;
      // 机器人代打：没人点，看一眼就自己翻下一张
      if (App.flags.autoplay) fx.delay(p.body, 1.2, () => p.close());
    })
    .start();
  // 全屏的 body 会拦下所有触摸（blockInput），点击要挂在它上面，挂在 root 上收不到
  onTap(p.body, () => ready && p.close(), { press: 0, sound: null });
}

/** 金币从 from 飞向 to（默认顶栏金币，ui.fx 坐标） */
export function coinsFly(from: [number, number], label?: Label, to: [number, number] = [-60, Screen.headY + 12]): void {
  for (let i = 0; i < 8; i++) {
    const c = img(ui.fx, 'icon/coin', 48, 48, 'coin');
    at(c, from[0] + (Math.random() - 0.5) * 60, from[1] + (Math.random() - 0.5) * 60);
    fx.flyArc(c, to[0], to[1], 0.5 + i * 0.04, 80, 'quadIn', () => {
      c.destroy();
      if (i === 0) sfx('coin');
    });
  }
  if (label) fx.popIn(label.node, 0.6, 0.2);
}
