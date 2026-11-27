// 配置表的类型。数值只在 assets/resources/config/*.json 里，代码不写死（CLAUDE.md 硬性约束 5）。

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legend';
/** 技能 id：示例玩法有 undo、hint、shuffle；换玩法时按自己的技能改（economy.json 的 skills.order） */
export type SkillId = string;

/** 一张收藏卡（config/cards.json）：图在 resources/card/<id>.png，名字文案 CARD_<id> */
export interface CardDef {
  id: string;
  /** 中文备注（界面上的名字走多语言 CARD_<id>） */
  name: string;
  rarity: Rarity;
  [k: string]: unknown;
}

/** 一份奖励：金币、每种技能各几个、随机技能几个、无限生命秒数 */
export interface Reward {
  coins?: number;
  tools?: number;
  skills?: number;
  unlimited?: number;
}

/** 章节（地图上的一大段关卡）：背景图 bg/chapter_<id>，名字文案 CHAPTER_<序号> */
export interface Chapter {
  id: string;
  /** 这一章的第一关 */
  levelFrom: number;
}

export interface Book {
  id: number;
  /** 这一册属于哪一章（Chapter.id），可不填 */
  chapter?: string;
  unlock: number;
  cards: string[];
  reward: Reward;
}

export interface Area {
  id: string;
  unlock: number;
  /** 每步 [星星, 金币] */
  steps: [number, number][];
  reward: Reward;
}

export interface ComboTier {
  at: number;
  coins: number;
  key: string;
}

export interface ComboConfig {
  windowSeconds: number;
  startAt: number;
  maxCoinsPerLevel: number;
  tiers: ComboTier[];
  cardChance: Record<string, number>;
  bestBonus: { minCombo: number; coinsPerCombo: number; max: number };
}

export interface WheelPrize {
  id: string;
  kind: 'coins' | 'skill' | 'unlimited' | 'card';
  amount?: number;
  rarity?: Rarity;
  weight: number;
}

export interface SignInDay {
  coins?: number;
  wheel?: number;
  skill?: number;
  chest?: { skill: number; card: number };
  bigChest?: { minRarity: Rarity; coins: number; unlimitedSeconds: number };
}

/** 一项每日任务。mode 为 max 时进度取单次最大值（最高连击），否则累加 */
export interface TaskDef {
  id: string;
  goal: number;
  points: number;
  /** 这项功能开放后才会抽到 */
  feature?: string;
  /** 平台有这项能力才留在池子里（启动时由服务层筛掉） */
  cap?: string;
  mode?: 'max';
}

/** 任务宝箱里的收藏卡：rates 不写就用过关宝箱的概率；minRarity 是最低稀有度 */
export interface TaskCard {
  rates?: Partial<Record<Rarity, number>>;
  minRarity?: Rarity;
  preferUnowned?: boolean;
}

/** 积分进度条上的一档宝箱 */
export interface TaskTier {
  points: number;
  reward?: Reward;
  card?: TaskCard;
}

export interface TasksConfig {
  /** 每天必有的任务 id */
  fixed: string[];
  /** 另外再随机抽几个（没有 count 时用：每天 fixed + random 项） */
  random: number;
  /** 每天几项（偶数，至少 6）：固定的进不了池子（如没有广告时的看广告）就多抽随机的补上 */
  count?: number;
  /** 每日积分封顶 */
  dayMax: number;
  pool: TaskDef[];
  dayTiers: TaskTier[];
  weekTiers: TaskTier[];
}

export interface EconomyConfig {
  levelCoins: number;
  challengeCoins: number;
  /** 超难关的过关金币（docs/01）；没配按 challengeCoins */
  bossCoins?: number;
  /** 全部免费的那几关（skills.freeAllUntil 以前）某几个技能单独的每关次数上限（撤销 3 次，docs/01） */
  toolMaxFreeById?: Record<string, number>;
  /**
   * 星级和首次三星（docs/01）：twoStarLine 用了几个道具以内两星；first3 第一次拿三星多送的（coins 金币、card 卡的稀有度、skill 几个随机技能），
   * 第 earlyUntil 关以前金币只给 earlyCoins
   */
  stars?: {
    twoStarLine: Record<'normal' | 'hard' | 'boss', number>;
    first3: Record<'normal' | 'hard' | 'boss', { coins: number; card?: string; skill?: number }>;
    earlyUntil: number;
    earlyCoins: number;
  };
  adCoinMultiplier: number;
  toolStart: Record<string, number>;
  toolPrice: Record<string, number>;
  /**
   * 全部免费的那几关（skills.freeAllUntil 以前）每关每种技能最多用几次。别的关不限次数：道具靠库存和金币买（docs/01）
   */
  toolMaxFree: number;
  dupeCoins: Record<Rarity, number>;
  freeCoin: { amount: number; daily: number };
  easeAfterFails: number[];
  combo: ComboConfig;
  rarities: Rarity[];
  lives: {
    max: number;
    regenSeconds: number;
    freeUntilLevel: number;
    buyOneCoins: number;
    refillCoins: number;
    firstWinUnlimitedSeconds: number;
    /** 看广告得命，每天几次 */
    adDaily?: number;
  };
  skills: {
    order: SkillId[];
    grantOnUnlock: number;
    freePerDay: number;
    freeDaily?: number;
    /** 第 1 关到第几关（含）：每关第一次用技能免费（没配 = 没有这一条） */
    freeLevelUntil?: number;
    /** 第 1 关到第几关（含）：技能随便用、都免费（每种每关仍按次数上限，docs/01） */
    freeAllUntil?: number;
    /** 第一次过了第 after 关送礼包：已解锁的每种技能各 count 个，告诉玩家「从下一关起要用库存或金币了」 */
    gift?: { after: number; count: number };
  };
  chapters?: Chapter[];
  album: { books: Book[]; final: Reward };
  dailyChallenge: {
    levelStep: number;
    retryCoins: number;
    reward: Reward;
    streakDays: number;
    streakReward: Reward;
  };
  tasks?: TasksConfig;
  features: Record<string, number>;
  chest: {
    normal: { coins: number; skill: number; card: number; coinMin: number; coinMax: number };
    challengeRareBoost: number;
    cardRates: Partial<Record<Rarity, number>>;
    pityAfter: number;
  };
  wheel: {
    freePerDay: number;
    firstWinSpins: number;
    adPerDay: number;
    coinCost: number;
    tenCost: number;
    tenCount: number;
    tenMinRarity: Rarity;
    pityAfter: number;
    pityMinRarity: Rarity;
    unlimitedSeconds: number;
    prizes: WheelPrize[];
  };
  signInDays: SignInDay[];
  replay: { rewardedPerDay: number };
}

export interface AdsConfig {
  placements: Record<string, { type: 'rewarded' | 'interstitial' | 'banner' }>;
  /** Banner 从第几关起出（前几关不出广告）；不给 = 一直出 */
  banner?: { minLevel: number };
  interstitial: {
    minLevel: number;
    minSeconds: number;
    minLevelsBetween: number;
    skipAfterRewardedSeconds: number;
  };
}

/**
 * 关卡参数表（assets/resources/config/levels.json）。示例玩法（core/demo）按它现场生成关卡，不用关卡文件；
 * 换成自己的玩法时把这里换成自己的参数（或者改成读 config/levels/level_XXXX.json，见 docs/02）
 */
export interface LevelSegment {
  /** 从第几关起用这一段 */
  from: number;
  /** 几种图案 [起, 止]（这一段内从起线性涨到止） */
  kinds: [number, number];
  /** 每种几组三个 */
  sets: [number, number];
  /** 叠几层 */
  layers: number;
}

export interface LevelsConfig {
  /** 关卡总数：超过后在后一半里循环（Meta.levelFile） */
  total: number;
  /** 每几关一个难关、每几关一个超难关（0 = 没有）；第一个难关在第 hardFrom 关（不给 = 第 hardEvery 关）。1、2、2、3 轮换就是 hardEvery 4 */
  hardEvery: number;
  bossEvery: number;
  hardFrom?: number;
  /** 暂存槽几格 */
  tray: number;
  segments: LevelSegment[];
  /** 难关、超难关在这一段的基础上加几种图案、几组 */
  hard: { kindsPlus: number; setsPlus: number };
  boss: { kindsPlus: number; setsPlus: number };
  /** 连输几次以后降一档（每档少一种图案）：和 economy.json 的 easeAfterFails 一起用 */
  easeKinds: number;
  /** 限时：第 from 关起的难关、超难关限时，秒数 = 块数 × perTile，至少 min；不配 = 都不限时 */
  clock?: { from: number; perTile: number; min: number };
  /** 难关、超难关之后的那一关放松（docs/02 第 5 节）：少几种图案（内容不减）；不配 = 不放松 */
  release?: { kindsMinus: number };
  /**
   * 单局时长（docs/02 第 5 节）：估算秒数 = 点击次数 × tapSec + 完成次数 × doneSec；
   * normal / hard / boss 是三种关的上限（秒，三分钟以内都可以），level-verify 报超标的关、测试会拦
   */
  pace: { tapSec: number; doneSec: number; normal: number; hard: number; boss: number };
  /**
   * 机器人（core/demo/bot.ts）不用道具的过关率目标（0–1，docs/02 第 5.8 节）：第 tutorialUntil 关以前是教学关不挑；
   * 头几关（到 early.until）缓一档；之后普通关、难关、超难关各一个数持平；放松关多 releasePlus
   */
  targets?: {
    tutorialUntil: number;
    early?: { until: number; normal: number; hard: number };
    normal: number;
    hard: number;
    boss: number;
    releasePlus: number;
  };
  /**
   * 5 档难度（docs/02 第 5.9 节）：每档的规模（图案种数、每种几组、层数）、过关率目标、有几个模板。
   * mix 是档位配比（第一行以前是教学期）；第 templatesFrom 关起每关从这一档的模板换图案、换摆法得来，同一个模板前后至少隔 templateGap 关
   */
  tiers?: Record<string, { name: string; kinds: number; sets: number; layers: number; target: number; count: number }>;
  mix?: [number, string[], string][];
  templatesFrom?: number;
  templateGap?: number;
  /** 挑候选（./run.sh level-pick）：每关几个候选、初量几局、复量几局；bot.slip 是机器人手滑的概率 */
  pick?: { candidates: number; games: number; checkGames: number; bot: { slip: number } };
}

/** 界面数值（动画时长、提示、教学），assets/resources/config/game_ui.json */
export interface GameUiConfig {
  /** 点中的块飞进暂存槽几秒；三个消掉前停几秒 */
  fly: { seconds: number; clearDelay: number };
  /** 开局：块依次弹出的间隔 */
  intro: { startDelay: number; stagger: number };
  /** 难关、超难关的开局横幅（docs/09）：滑进来几秒、停几秒、缩成小牌子飞过去几秒 */
  kindBanner: { slideIn: number; hold: number; fly: number };
  /** 难度调试页的整体三档（开发版）：下标 = 档 + 1（困难、标准、简单）；tray 暂存槽加减几格，window 连击窗口秒数（0 = 照 economy.json） */
  labTiers: { tray: number; window: number }[];
  /**
   * 演示：每步先圈出来停 ring 秒再点，点完隔 gap 秒。机器人代打每步停 pause[0]–pause[1] 秒（随机），
   * 有 slowChance 的几率想久一点（slow[0]–slow[1] 秒），像真人在点；
   * 录屏（./run.sh record，?fast=1）每步只停 fastPause[0]–fastPause[1] 秒、不想久，像熟手在点
   */
  demo: { ring: number; gap: number; pause: [number, number]; slowChance: number; slow: [number, number]; fastPause: [number, number] };
  /** 限时关：剩几秒以内变色、跳动 */
  clock: { warn: number };
  /** 暂存槽：剩几格时变红闪；剩几格时提醒用道具（rescueSkills 里的发光，nudgeHand 第一个能用的放小手） */
  tray: { warnFree: number; skillNudgeFree: number; rescueSkills: string[]; nudgeHand: string[] };
  /** 闲着不点几秒后亮提示；前 tutorialLevels 关等 tutorialSeconds 秒 */
  hint: { tutorialLevels: number; tutorialSeconds: number; seconds: number };
  /** 第几关开局弹哪几条说明（文案键，逗号隔开） */
  tips: Record<string, string>;
  tutorial: { delay: number };
  unlockGuide: { delay: number; lockSeconds: number; sparks: number };
  /** 结算页的演出时间点（秒）：celebrate、starAt、starGap、coinsAt、coinsRoll、chestAt、chestShake、buttonsAt */
  win: Record<string, number | string>;
  /** 技能、数量角标最多显示到几 */
  badgeCap: number;
  /** 主页中间的展示：[收藏卡 id, x, y, 尺寸]（换成自己的吉祥物、主角） */
  homeDeco: { hero: [string, number, number, number][] };
}
