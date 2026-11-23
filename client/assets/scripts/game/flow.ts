// 局内流程（底座）：开局说明、第一步、技能、暂停 / 离开、复活 / 失败、过关结算。
// 界面只调这里，这里调 core；存档在关键节点立即写。换玩法时只改标了「玩法」的几处（技能效果、失败原因、任务计数）。
import { Node, Sprite, UITransform, Vec3, tween } from 'cc';
import * as Album from '../core/meta/album';
import * as Cards from '../core/meta/cards';
import * as DailyChallenge from '../core/meta/dailyChallenge';
import * as LevelChest from '../core/meta/levelChest';
import * as Stars from '../core/meta/stars';
import * as Lives from '../core/meta/lives';
import * as Meta from '../core/meta/meta';
import * as PlayerData from '../core/meta/playerData';
import type { CardResult } from '../core/meta/save';
import * as Settle from '../core/meta/settle';
import * as Skills from '../core/meta/skills';
import * as Tasks from '../core/meta/tasks';
import { LoseReason, Status } from '../core/demo/rules';
import * as Rules from '../core/demo/rules';
import { Rng } from '../core/rng/rng';
import { App } from '../services/app';
import { playMusic, sfx } from '../services/audio';
import { adNow, now, today } from '../services/clock';
import * as fx from '../ui/fx';
import { tr } from '../ui/i18n';
import { COLOR, at, button, img, text } from '../ui/kit';
import { closeAllPopups, openPopup, popupCount } from '../ui/popup';
import { confirmLeave, giftPopup, livesPopup, revealCards, settingsPopup, skillName, spend, watchAd } from '../ui/popups';
import { ui } from '../ui/shell';
import type { GamePage } from './gameView';
import { levelKind } from './levelKind';

const rng = new Rng(Date.now() >>> 0);

/** 局内送出的卡（连击）：当场提示，结算时翻 */
const pendingCards: CardResult[] = [];

// ---------------------------------------------------------------- 开始

/** 从主页 / 选关开始一关：生命不够弹生命弹窗（docs/01） */
export function startLevel(level: number): void {
  const s = App.save.data;
  if (!Lives.canStart(s, App.config.eco, level, now())) {
    livesPopup();
    return;
  }
  pendingCards.length = 0;
  ui.go('game', { level });
}

/** 难度调试页：电脑按参考解替玩家打一遍（能打完就证明这一关一定过得去）。不记成绩、不扣命，打完回调试页；画面上不出字，结果写控制台 */
export function startDemo(level: number): void {
  pendingCards.length = 0;
  ui.go('game', { level, demo: 'route' });
}

function demoDone(g: GamePage, msg: string): void {
  g.ended = true;
  pendingCards.length = 0;
  closeAllPopups();
  // 画面上不出字（录屏、直播用），结果只写控制台
  console.info(`[演示] 第 ${g.arg.level} 关：${msg}`);
  ui.go('lab');
}

export function demoStuck(g: GamePage): void {
  demoDone(g, `演示第 ${g.demoStep} 步点不下去（参考解和局面对不上），截图告诉开发`);
}

/**
 * 进每日挑战。pay 不给 = 当天的免费次（第一步有效操作时才记）；ad / coins = 重试，关卡读出来了才记账（payDaily）。
 * 挑战日在这里定好带进局里，过了零点也按这一天结算
 */
export function startDaily(pay?: 'ad' | 'coins'): void {
  pendingCards.length = 0;
  const s = App.save.data;
  const eco = App.config.eco;
  const day = today();
  // 昨天的重试页开着过了零点：今天的第一局本来免费，不扣金币、不算看广告的那次
  if (pay && DailyChallenge.canStartFree(s, day)) pay = undefined;
  const level = DailyChallenge.levelFor(day, s.level, eco.dailyChallenge.levelStep, App.config.levelCount);
  ui.go('game', { level, daily: true, day, pay });
}

/** 看完了重试广告、还没进成关（读关卡失败）的那一天：再点重试不用重看 */
let dailyAdPaid = -1;
export function markDailyAd(day: number): void {
  dailyAdPaid = day;
}
export function dailyAdPaidFor(day: number): boolean {
  return dailyAdPaid === day;
}

/** 这局每日挑战算哪一天 */
export function dailyDay(g: GamePage): number {
  return g.arg.day ?? today();
}

/** 关卡读出来以后记每日挑战重试的账。记不上（金币不够了、这天已经过了）回挑战页，返回 false */
export function payDaily(g: GamePage): boolean {
  if (!g.arg.daily || !g.arg.pay) return true;
  const s = App.save.data;
  const day = dailyDay(g);
  if (!DailyChallenge.enter(s, App.config.eco, day, g.arg.pay)) {
    ui.go('daily');
    return false;
  }
  if (g.arg.pay === 'ad') dailyAdPaid = -1;
  App.save.write();
  return true;
}

export function onLevelStart(g: GamePage): void {
  playMusic();
  const s = App.save.data;
  if (g.arg.demo) return;
  if (App.flags.autoplay && !g.arg.daily) {
    g.showIntro();
    return;
  }
  if (g.arg.daily) return; // 每日挑战不出说明、提示和技能教学
  const lvl = g.arg.level;
  // 这一关要弹的说明（game_ui.json 的 tips：关卡号 → 文案键，逗号隔开）
  const tips: string[] = [];
  const extra = App.config.ui.tips[String(lvl)];
  if (extra) for (const key of extra.split(',')) tips.push(key);
  // 解锁关的新技能：不弹窗，等第一次能用上时压暗全屏强制教（checkTutorial）
  g.tutor = '';
  for (const id of Skills.ids(App.config.eco)) {
    if (Skills.unlockLevel(App.config.eco, id) === lvl && !PlayerData.tipSeen(s, `skill_${id}`)) g.tutor = id;
  }
  const show = (i: number) => {
    const key = tips[i];
    // 说明都看完了：难关、超难关出开局横幅
    if (key === undefined) return g.showIntro();
    if (PlayerData.tipSeen(s, key)) return show(i + 1);
    PlayerData.markTip(s, key);
    App.save.write();
    g.paused = true;
    tipPopup(key, () => {
      g.paused = false;
      show(i + 1);
    });
  };
  fx.delay(g.node, App.config.ui.tutorial.delay, () => show(0));
}

/** 一条说明：上面一张图（技能是技能图标，其它是 icon/tip_<键> 没有就用星星），下面一句话，「知道了」 */
function tipPopup(key: string, done: () => void): void {
  const isSkill = key.startsWith('skill_');
  const id = key.slice(6);
  const p = openPopup({ w: 600, h: 580, title: tr('MECH_TITLE'), onClose: done });
  const icon = img(p.body, isSkill ? `icon/skill_${id}` : 'icon/star', 190, 190, 'icon');
  at(icon, 0, 110);
  fx.breathe(icon, 0.06, 1.2);
  const msg = isSkill ? tr('UI_SKILL_TRY', skillName(id)) : tr(key);
  const l = text(p.body, msg, 32, { width: 520 });
  at(l.node, 0, -72);
  const ok = button(p.body, { color: 'green', w: 340, h: 96, label: tr('GOT_IT'), onTap: () => p.close() });
  at(ok.node, 0, -202);
}

/** 新技能的强制教学：这一关第一次能用上它（有效果）时才开始 */
export function checkTutorial(g: GamePage): void {
  const id = g.tutor;
  if (!id || g.ended || g.paused || g.s.status !== Status.PLAYING || popupCount() > 0 || App.flags.autoplay || g.arg.demo) return;
  if ((g.used[id] ?? 0) > 0) {
    g.tutor = '';
    return;
  }
  if (hasEffect(g, id)) return;
  const s = App.save.data;
  PlayerData.markTip(s, `skill_${id}`);
  App.save.write();
  g.startTutorial(id, () => {
    // 强制教学这一次不算进星级的道具数（docs/01）
    const before = g.usedAll;
    useSkill(g, id);
    if (g.usedAll > before) g.freebies++;
  });
}

/** 第一步有效操作：每日挑战的免费次这时才记（docs/01） */
export function onFirstMove(g: GamePage): void {
  if (!g.arg.daily) return;
  const s = App.save.data;
  const day = dailyDay(g);
  if (DailyChallenge.isFree(s, day)) {
    DailyChallenge.enter(s, App.config.eco, day, 'free');
    App.save.write();
  }
}

// ---------------------------------------------------------------- 技能

/** 玩法：当前没有效果的技能不扣数量，返回提示的文案键；有效果返回 null */
export function hasEffect(g: GamePage, id: string): string | null {
  if (id === 'undo') return g.canUndo ? null : 'UI_UNDO_EMPTY';
  if (id === 'hint') return Rules.hint(g.s) >= 0 ? null : 'UI_HINT_EMPTY';
  if (id === 'shuffle') return g.s.left() >= 2 ? null : 'UI_SHUFFLE_EMPTY';
  return null;
}

/** 点技能键：没解锁响错误音；没效果提示一句；次数用完提示；没库存弹购买；能用就扣、调规则 */
export function useSkill(g: GamePage, id: string): void {
  if (g.ended || g.paused || g.s.status !== Status.PLAYING) return;
  const s = App.save.data;
  const eco = App.config.eco;
  const lvl = g.arg.daily ? s.level : Math.max(s.level, g.arg.level);
  if (!Skills.isUnlocked(eco, id, lvl)) {
    sfx('error');
    return;
  }
  const none = hasEffect(g, id);
  if (none) {
    ui.toast(tr(none));
    return;
  }
  const used = g.used[id] ?? 0;
  const r = Skills.tryUse(s, eco, id, used, today(), g.freeLevelId, g.usedAll);
  if (!r.ok) {
    if (r.reason === 'limit') ui.toast(tr('UI_TOOL_LIMIT'));
    else if (r.reason === 'empty') buySkill(g, id);
    return;
  }
  g.used[id] = used + 1;
  App.save.write();
  g.refreshSkills();
  sfx(id);
  // 玩法：各技能的效果
  if (id === 'undo') {
    g.undo();
    g.refreshSkills();
  } else if (id === 'hint') g.showSkillHint();
  else if (id === 'shuffle') g.act(() => Rules.useShuffle(g.s, rng.nextU32()));
}

/** 数量为 0：金币买，金币不够则看广告得 1 个（docs/01）；这一版没有广告时只有金币买，弹窗矮一截 */
function buySkill(g: GamePage, id: string): void {
  const eco = App.config.eco;
  // 看广告的那一行：这一版有广告、而且现在拉到了才有；拉不到整行不出现、弹窗矮一截
  const hasAds = App.platform.hasCapability('ads') && App.platform.adsAvailable();
  const dy = hasAds ? 0 : -55;
  const name = skillName(id);
  const p = openPopup({ w: 600, h: hasAds ? 560 : 450, title: tr('SKILL_BUY_TITLE', name), mascot: null });
  const icon = img(p.body, `icon/skill_${id}`, 180, 180, 'icon');
  at(icon, 0, 100 + dy);
  const price = Skills.price(eco, id);
  const buy = button(p.body, {
    color: 'green',
    w: 420,
    h: 100,
    icon: 'icon/coin',
    label: String(price),
    onTap: () => {
      const grant = () => {
        Skills.add(App.save.data, id);
        App.save.write();
        p.close();
        g.refreshSkills();
      };
      // 金币不够：看广告直接领 1 个（docs/01 7.1）
      if (!spend(price, { icon: `icon/skill_${id}`, placement: 'rv_tool', grant })) return;
      Skills.buy(App.save.data, eco, id);
      App.save.write();
      sfx('coin');
      p.close();
      g.refreshSkills();
    },
  });
  at(buy.node, 0, -60 + dy);
  if (!hasAds) return;
  const ad = button(p.body, {
    color: 'yellow',
    w: 420,
    h: 92,
    icon: 'kit/ic_video',
    label: tr('SKILL_AD'),
    onTap: async () => {
      if (!(await watchAd('rv_tool'))) return;
      Skills.add(App.save.data, id);
      App.save.write();
      p.close();
      g.refreshSkills();
    },
  });
  at(ad.node, 0, -170);
}

// ---------------------------------------------------------------- 暂停、离开

export function pause(g: GamePage): void {
  if (g.ended) return;
  g.paused = true;
  // 暂停弹窗底部放 Banner（docs/01：结算、暂停弹窗底部；前几关不出）
  if (Meta.shouldShowBanner(App.config.ads, g.arg.level)) App.platform.showBanner('bn_result');
  settingsPopup('pause', {
    onClose: () => {
      g.paused = false;
      App.platform.hideBanner();
    },
    onHome: () => {
      // 机器人代打：暂停 → 回主页就停
      App.flags.autoplay = false;
      leave(g, () => ui.go(g.arg.daily ? 'daily' : g.arg.demo ? 'lab' : 'home'));
    },
    onRetry: () => leave(g, () => restart(g)),
  });
}

/** 走过步时离开 / 重试要扣命，先确认（docs/01） */
function leave(g: GamePage, then: () => void): void {
  if (g.arg.demo) {
    then();
    return;
  }
  const s = App.save.data;
  const eco = App.config.eco;
  const costs = !g.arg.daily && g.moved && g.arg.level > eco.lives.freeUntilLevel && !Lives.isUnlimited(s, now());
  const go = () => {
    endRun(g);
    if (!g.arg.daily && g.moved) {
      Lives.lose(s, eco, g.arg.level, true, now());
      Meta.failLevel(s, eco, g.arg.level);
    }
    App.save.write();
    then();
  };
  if (costs) confirmLeave(go);
  else go();
}

function restart(g: GamePage): void {
  if (g.arg.demo) {
    startDemo(g.arg.level);
    return;
  }
  if (g.arg.daily) {
    ui.go('daily');
    return;
  }
  if (!Lives.canStart(App.save.data, App.config.eco, g.arg.level, now())) {
    ui.go('home');
    livesPopup();
    return;
  }
  // 上一局局内拿到的卡（已经发过、当场提示过）不再带进这一局的结算
  pendingCards.length = 0;
  ui.go('game', { level: g.arg.level });
}

/** 一局结束（过关、失败、离开）都要做的：最高连击记进存档 */
function endRun(g: GamePage): void {
  const s = App.save.data;
  s.bestCombo = Math.max(s.bestCombo, g.combo.best);
  // 每日任务：输了、中途离开也算；一局只记一次
  if (g.tallied) return;
  g.tallied = true;
  const eco = App.config.eco;
  // 玩法：每日任务的计数（任务 id 在 economy.json 的 tasks.pool）
  Tasks.add(s, eco, today(), 'clear', g.cleared);
  Tasks.add(s, eco, today(), 'combo', g.combo.best);
  Tasks.add(s, eco, today(), 'play');
}

// ---------------------------------------------------------------- 连击送卡

export function comboCard(g: GamePage): void {
  if (g.arg.demo) return;
  const s = App.save.data;
  const eco = App.config.eco;
  const rarity = Cards.rollRarity(eco, eco.chest.cardRates, rng);
  const card = Cards.give(s, eco, Cards.pick(s, Album.pool(eco, App.config.cards, s.level), rarity, rng));
  pendingCards.push(card);
  App.save.write();
  // 提示放在屏幕中间偏下、晚半拍出来：不和上面的升档夸奖词叠在一起
  fx.delay(g.fxLayer(), 0.45, () => {
    const tip = text(null, tr('UI_COMBO_CARD'), 44, { color: COLOR.yellow });
    tip.updateRenderData(true);
    const card = img(tip.node, 'icon/card_back', 54, 72, 'card');
    at(card, -(tip.node.getComponent(UITransform)?.width ?? 300) / 2 - 44, 0);
    card.angle = 10;
    fx.floatUp(g.fxLayer(), tip.node, 22, -60, 90, 1.3);
    sfx('card');
  });
}

// ---------------------------------------------------------------- 失败、复活

/** 玩法：失败原因 → 失败页、复活页的文案 */
const LOSE_KEY: Record<number, string> = {
  [LoseReason.TRAY_FULL]: 'UI_LOSE_TRAY',
  [LoseReason.CLOCK]: 'UI_LOSE_TIMEOUT',
};
const REVIVE_KEY: Record<number, string> = {
  [LoseReason.TRAY_FULL]: 'REVIVE_TRAY',
  [LoseReason.CLOCK]: 'REVIVE_CLOCK',
};

export function lose(g: GamePage): void {
  if (g.s.status !== Status.LOST) return;
  if (g.arg.demo) {
    demoDone(g, `电脑按参考解没过（第 ${g.demoStep} 步），不该发生，截图告诉开发`);
    return;
  }
  sfx('lose');
  if (App.flags.autoplay && !g.arg.daily) {
    autoRetry(g);
    return;
  }
  // 每关一次复活（看广告）；没有广告直接失败
  if (!g.s.revived && App.platform.adsAvailable()) revivePopup(g);
  else failPopup(g);
}

/** 复活：按失败原因写效果，每关一次，看广告 */
function revivePopup(g: GamePage): void {
  g.paused = true;
  const reason = g.s.loseReason;
  const p = openPopup({ w: 640, h: 760, title: tr('REVIVE_TITLE'), noClose: true, mascot: null });
  const orb = img(p.body, 'kit/orb', 300, 300, 'orb');
  at(orb, 0, 130);
  const hero = img(orb, 'icon/heart', 180, 180, 'hero');
  fx.bob(hero, 8, 1.6);
  const line = text(p.body, tr(REVIVE_KEY[reason] ?? 'H_REVIVE_LINE'), 34, { width: 540 });
  at(line.node, 0, -70);
  const ad = button(p.body, {
    color: 'yellow',
    w: 500,
    h: 110,
    icon: 'kit/ic_video',
    label: tr('H_REVIVE_AD'),
    onTap: async () => {
      if (!(await watchAd('rv_revive'))) return;
      p.close();
      g.paused = false;
      g.extras++;
      Rules.revive(g.s);
      g.resync();
    },
  });
  at(ad.node, 0, -190);
  const give = button(p.body, {
    color: 'blue',
    w: 460,
    h: 92,
    label: tr('H_GIVE_UP'),
    onTap: () => {
      p.close();
      failPopup(g);
    },
  });
  at(give.node, 0, -300);
}

/** 失败：原因、扣命时「生命 −1」、重试 / 回主页；每日挑战回每日挑战页走再试流程 */
function failPopup(g: GamePage): void {
  g.ended = true;
  g.paused = true;
  endRun(g);
  const s = App.save.data;
  const eco = App.config.eco;
  let lost = false;
  if (!g.arg.daily) {
    lost = Lives.lose(s, eco, g.arg.level, g.moved, now());
    Meta.failLevel(s, eco, g.arg.level);
  }
  App.save.write();
  const p = openPopup({ w: 640, h: 700, title: tr('UI_LOSE'), noClose: true });
  const sad = img(p.body, 'icon/heart', 200, 200, 'sad');
  (sad.getComponent(Sprite) as Sprite).grayscale = true;
  at(sad, 0, 200);
  sad.angle = -8;
  fx.bob(sad, 6, 2);
  const why = text(p.body, tr(LOSE_KEY[g.s.loseReason] ?? 'UI_LOSE'), 40);
  at(why.node, 0, 50);
  if (lost) {
    const h = img(p.body, 'icon/heart', 56, 56, 'heart');
    at(h, -70, -24);
    const t = text(p.body, tr('LIFE_MINUS'), 32, { color: COLOR.yellow });
    at(t.node, 30, -24);
  }
  const retry = button(p.body, {
    color: 'green',
    w: 480,
    h: 112,
    fontSize: 44,
    label: tr(g.arg.daily ? 'DAILY_RETRY' : 'H_RETRY'),
    onTap: () => {
      p.close();
      restart(g);
    },
  });
  at(retry.node, 0, -148);
  const home = button(p.body, {
    color: 'blue',
    w: 440,
    h: 92,
    fontSize: 36,
    label: tr('H_TO_HOME'),
    onTap: () => {
      p.close();
      ui.go(g.arg.daily ? 'daily' : 'home');
    },
  });
  at(home.node, 0, -262);
}

// ---------------------------------------------------------------- 过关

export interface WinData {
  level: number;
  result: Settle.WinResult;
  chest: LevelChest.ChestResult | null;
  cards: CardResult[];
  combo: number;
  best: number;
  challenge: boolean;
  /** 这次拿了几颗星、是不是第一次三星（奖励已经入账，docs/01） */
  stars: Stars.StarResult;
}

export function win(g: GamePage): void {
  if (g.arg.demo) {
    demoDone(g, g.arg.demo === 'route' ? `电脑按路线过了：${g.demoStep} 步，没用道具` : `正常打法这局过了（${g.demoStep} 步）`);
    return;
  }
  endRun(g);
  const s = App.save.data;
  const eco = App.config.eco;
  if (g.arg.daily) {
    const r = DailyChallenge.win(s, eco, App.config.cards, dailyDay(g), now(), rng, g.combo.coins, today());
    App.save.write();
    sfx('win');
    ui.go('daily', { won: r });
    return;
  }
  const result = Settle.win(s, eco, {
    level: g.arg.level,
    challenge: g.lv.kind !== 'normal',
    boss: g.lv.kind === 'boss',
    day: today(),
    now: now(),
    combo_coins: g.combo.coins,
    best_combo: g.combo.best,
  });
  // 星级（docs/01）：按这一关用了几样道具记星；第一次三星多送一份（金币当场入账、卡进结算页的开卡）
  const stars = Stars.record(s, eco, g.arg.level, levelKind(g.arg.level), g.items, Album.pool(eco, App.config.cards, s.level), rng, App.featureOpen('album'));
  if (stars.first3?.card) pendingCards.push(stars.first3.card);
  // 过关宝箱
  const chest = result.chest_ok ? LevelChest.open(s, eco, App.config.cards, g.arg.level, g.lv.kind !== 'normal', rng) : null;
  App.save.write();
  const cards = [...pendingCards];
  pendingCards.length = 0;
  if (chest?.card) cards.push(chest.card);
  closeAllPopups();
  ui.go('result', {
    level: g.arg.level,
    result,
    chest,
    cards,
    combo: g.combo.coins,
    best: g.combo.best,
    challenge: g.lv.kind !== 'normal',
    stars,
  } satisfies WinData);
}

/**
 * 结算页关掉时：开放了新功能先回主页看解锁动画；否则按插屏频控弹插屏（docs/01）。
 * 「下一关」接着刚打的那一关往后走（重玩旧关时不跳回最高进度，docs/01）。
 */
/**
 * 过关新开放、还没在主页播过解锁动画的功能。点「下一关」直接进下一关（开了新功能的那几关点「下一关」回了主页，
 * 看着像 bug），解锁动画留到下次回主页时播
 */
const pendingUnlocks: string[] = [];

/** 主页取走待播的解锁动画（取完清空） */
export function takeUnlocks(): string[] {
  return pendingUnlocks.splice(0);
}

/** 正在离开的那一页结算（等插屏的时候）：再点「下一关」「回主页」、按返回键都不再走第二遍 */
let leaving: WinData | null = null;

export async function afterResult(d: WinData, next: boolean): Promise<void> {
  if (leaving === d) return;
  const s = App.save.data;
  // 道具礼包（第一次过了礼包关）：先弹出来说清楚，关掉再往下走（docs/01）
  const gift = d.result.gift;
  if (gift && gift.length > 0) {
    d.result.gift = undefined;
    giftPopup(gift, App.config.eco.skills.gift?.count ?? 1, () => void afterResult(d, next));
    return;
  }
  // 这一次走完之前不再走第二遍：原来等插屏时连点两个键，两次都会跳转，广告关掉后又被带去先点的那页
  leaving = d;
  try {
    // 真播出来了才记频控（没拉到广告不算一次）
    if (Meta.shouldShowInterstitial(s, App.config.ads, d.level, adNow(s.ads))) {
      let shown = false;
      ui.busy(true);
      try {
        shown = await App.platform.showInterstitial('int_level_end');
      } catch (e) {
        // 广告出错按没播处理，照常往下走（不能卡在结算页）
        console.warn('插屏出错', e);
      } finally {
        ui.busy(false);
      }
      if (shown) {
        Meta.markInterstitial(s, d.level, adNow());
        App.save.write();
      }
    }
    for (const f of d.result.new_features) if (!pendingUnlocks.includes(f)) pendingUnlocks.push(f);
    if (next) startLevel(Math.min(d.level + 1, Math.max(s.level, App.flags.boost ? App.config.levelCount : 0)));
    else ui.go('home');
  } finally {
    // 没离开结算页（没体力时「下一关」只弹生命窗）：放开，关掉弹窗还能再点「下一关」「回主页」
    if (ui.currentName === 'result') leaving = null;
  }
}

export function revealPending(cards: CardResult[], done: () => void): void {
  revealCards(cards, done);
}

// ---------------------------------------------------------------- 机器人代打（调试，./run.sh auto）

/** 代打打到第几关为止 */
function autoLast(): number {
  const to = App.flags.autoTo;
  return to > 0 ? Math.min(to, App.config.levelCount) : App.config.levelCount;
}

/** 代打进第 level 关：跳过生命检查（输了重打不扣命），换关的间隙不弹东西 */
function autoStart(level: number): void {
  pendingCards.length = 0;
  closeAllPopups();
  ui.go('game', { level });
}

/** 代打：结算页的卡翻完后停一会儿，自己点「下一关」（和真人点一样走 afterResult：礼包、插屏照常出）；打完最后一关回主页 */
export function autoNext(d: WinData): void {
  if (!App.flags.autoplay) return;
  fx.delay(ui.fx, 1.6, () => {
    // 等的时候有人点了「下一关」或回主页，就不再替他点
    if (ui.pageName !== 'result') return;
    if (d.level >= autoLast()) {
      App.flags.autoplay = false;
      ui.go('home');
      return;
    }
    void afterResult(d, true);
  });
}

/** 代打输了：不弹复活和失败窗，记一次失败后重打这一关 */
function autoRetry(g: GamePage): void {
  g.ended = true;
  g.paused = true;
  endRun(g);
  Meta.failLevel(App.save.data, App.config.eco, g.arg.level);
  App.save.write();
  const level = g.arg.level;
  fx.delay(g.node, 1.2, () => autoStart(level));
}

export function nudge(n: Node): void {
  tween(n).to(0.1, { scale: new Vec3(1.1, 1.1, 1) }).to(0.1, { scale: new Vec3(1, 1, 1) }).start();
}
