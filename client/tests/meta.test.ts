// 外围系统（core/meta）的规则：数值从 economy.json 读，不在测试里写死，改了数值测试照样过；改了规则要改这里。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Album from '../assets/scripts/core/meta/album';
import { Combo } from '../assets/scripts/core/meta/combo';
import * as DailyChallenge from '../assets/scripts/core/meta/dailyChallenge';
import * as Features from '../assets/scripts/core/meta/features';
import * as LevelChest from '../assets/scripts/core/meta/levelChest';
import * as Lives from '../assets/scripts/core/meta/lives';
import * as Meta from '../assets/scripts/core/meta/meta';
import * as PlayerData from '../assets/scripts/core/meta/playerData';
import * as Settle from '../assets/scripts/core/meta/settle';
import * as SignIn from '../assets/scripts/core/meta/signIn';
import * as Skills from '../assets/scripts/core/meta/skills';
import * as Stars from '../assets/scripts/core/meta/stars';
import * as Tasks from '../assets/scripts/core/meta/tasks';
import * as Wheel from '../assets/scripts/core/meta/wheel';
import { Rng } from '../assets/scripts/core/rng/rng';
import { ads, cards, eco as loadEco, fresh } from './helpers';

const ECO = loadEco();
const CARDS = cards();
const NOW = 3_000_000;
const DAY = 100;

describe('生命', () => {
  it('按 regenSeconds 恢复，离线只恢复到上限', () => {
    const s = fresh(ECO, 30);
    s.lives.count = 0;
    s.lives.stamp = NOW;
    s.lives.lastNow = NOW;
    assert.equal(Lives.count(s, ECO, NOW + ECO.lives.regenSeconds), 1);
    assert.equal(Lives.count(s, ECO, NOW + ECO.lives.regenSeconds * 100), ECO.lives.max);
  });

  it('前几关不扣命；无限生命期间不扣', () => {
    const s = fresh(ECO, 30);
    assert.equal(Lives.lose(s, ECO, ECO.lives.freeUntilLevel, true, NOW), false);
    Lives.grantUnlimited(s, 600, NOW);
    assert.equal(Lives.lose(s, ECO, 30, true, NOW + 10), false);
  });
});

describe('结算与进度', () => {
  it('过当前关：发金币、进度 +1、当天首胜送转盘次数和无限生命', () => {
    const s = fresh(ECO, 7);
    const r = Settle.win(s, ECO, { level: 7, challenge: false, day: DAY, now: NOW });
    assert.equal(s.level, 8);
    assert.equal(r.coins, ECO.levelCoins);
    assert.ok(r.first_win);
    assert.ok(Wheel.spinsLeft(s, ECO, DAY) > 0);
  });

  it('重玩旧关不推进度', () => {
    const s = fresh(ECO, 20);
    Settle.win(s, ECO, { level: 3, challenge: false, day: DAY, now: NOW });
    assert.equal(s.level, 20);
  });

  it('功能按关开放', () => {
    for (const f of Object.keys(ECO.features)) {
      const at = Features.unlockLevel(ECO, f);
      assert.equal(Features.isUnlocked(ECO, f, at - 1), false, f);
      assert.equal(Features.isUnlocked(ECO, f, at), true, f);
    }
  });

  it('超过关卡总数后只在后一半循环', () => {
    assert.equal(Meta.levelFile(120, 120), 120);
    assert.equal(Meta.levelFile(121, 120), 61);
  });

  it('插屏频控：太早不弹', () => {
    const s = fresh(ECO, 1);
    assert.equal(Meta.shouldShowInterstitial(s, ads(), 1, NOW), false);
  });

  it('前几关不出广告：插屏第 15 关起，Banner 第 10 关起；插屏至少隔 2 关、90 秒，刚看完激励视频不弹', () => {
    const s = fresh(ECO, 1);
    const a = ads();
    assert.equal(Meta.shouldShowInterstitial(s, a, 14, 1000), false);
    assert.equal(Meta.shouldShowInterstitial(s, a, 15, 1000), true);
    Meta.markInterstitial(s, 15, 1000);
    assert.equal(Meta.shouldShowInterstitial(s, a, 16, 2000), false, '至少隔 2 关');
    assert.equal(Meta.shouldShowInterstitial(s, a, 17, 1050), false, '至少隔 90 秒');
    Meta.markRewarded(s, 1990);
    assert.equal(Meta.shouldShowInterstitial(s, a, 17, 2000), false, '刚看完激励视频');
    assert.equal(Meta.shouldShowBanner(a, 9), false);
    assert.equal(Meta.shouldShowBanner(a, 10), true);
  });
});

describe('连击', () => {
  it('startAt 起算，到档位升档，金币封顶', () => {
    const c = new Combo();
    const rng = new Rng(1);
    let coins = 0;
    for (let i = 1; i <= 40; i++) coins += c.hit(i * 0.1, ECO.combo, rng, false).coins;
    assert.equal(c.best, 40);
    assert.equal(coins, ECO.combo.maxCoinsPerLevel);
  });

  it('超过窗口断连', () => {
    const c = new Combo();
    const rng = new Rng(1);
    c.hit(0, ECO.combo, rng);
    const r = c.hit(ECO.combo.windowSeconds + 1, ECO.combo, rng);
    assert.equal(r.count, 1);
  });
});

describe('技能', () => {
  it('没解锁不能用；没库存、没免费次时要买', () => {
    const id = ECO.skills.order[0];
    const at = Skills.unlockLevel(ECO, id);
    const s = fresh(ECO, Math.max(1, at - 1));
    if (at > 1) assert.equal(Skills.canUse(s, ECO, id, 0), 'locked');
    s.level = (ECO.skills.freeAllUntil ?? 0) + 50;
    s.daily.toolFree = Object.fromEntries(ECO.skills.order.map((k) => [k, true]));
    s.daily.day = DAY;
    assert.equal(Skills.tryUse(s, ECO, id, 0, DAY, s.level, 0).reason, 'empty');
    Skills.add(s, id);
    assert.ok(Skills.tryUse(s, ECO, id, 0, DAY, s.level, 0).ok);
  });
});

describe('签到、转盘、任务、宝箱、星级、收藏、每日挑战', () => {
  it('签到一天一次', () => {
    const s = fresh(ECO, 30);
    const rng = new Rng(2);
    assert.ok(SignIn.canClaim(s, DAY));
    SignIn.claim(s, ECO, CARDS, rng, DAY, NOW);
    assert.equal(SignIn.canClaim(s, DAY), false);
    assert.ok(SignIn.canClaim(s, DAY + 1));
  });

  it('转盘：每天的免费次用完就没有了', () => {
    const s = fresh(ECO, 30);
    const rng = new Rng(3);
    const n = Wheel.spinsLeft(s, ECO, DAY);
    for (let i = 0; i < n; i++) Wheel.spin(s, ECO, CARDS, rng, DAY, NOW, 'spin');
    assert.equal(Wheel.spinsLeft(s, ECO, DAY), 0);
  });

  it('转盘概率加起来 100%', () => {
    const sum = Wheel.odds(ECO).reduce((a, o) => a + o.percent, 0);
    assert.ok(Math.abs(sum - 100) < 0.01);
  });

  it('每日任务：每天 count 项，做完能领积分宝箱', () => {
    const s = fresh(ECO, 30);
    const list = Tasks.list(s, ECO, DAY);
    assert.equal(list.length, ECO.tasks?.count);
    for (const t of list) Tasks.add(s, ECO, DAY, t.id, t.goal);
    assert.ok(Tasks.claimable(s, ECO, DAY) > 0);
  });

  it('过关宝箱：收藏开放前不出卡', () => {
    const s = fresh(ECO, 2);
    const rng = new Rng(4);
    for (let i = 0; i < 30; i++) assert.notEqual(LevelChest.open(s, ECO, CARDS, 2, false, rng).kind, 'card');
  });

  it('星级：不用道具三颗星', () => {
    assert.equal(Stars.starsFor(ECO, 'normal', 0), 3);
  });

  it('收藏：每一册的卡都在 cards.json 里，开放后卡池只出开放的册子', () => {
    const ids = new Set(CARDS.map((c) => c.id));
    for (const b of ECO.album.books) for (const id of b.cards) assert.ok(ids.has(id), `${id} 不在 cards.json`);
    const pool = Album.pool(ECO, CARDS, ECO.album.books[0].unlock);
    assert.deepEqual(new Set(pool.map((c) => c.id)), new Set(ECO.album.books[0].cards));
  });

  it('每日挑战：当天免费一次，第一步走了才记', () => {
    const s = fresh(ECO, 30);
    assert.ok(DailyChallenge.canStartFree(s, DAY));
    DailyChallenge.enter(s, ECO, DAY, 'free');
    assert.equal(DailyChallenge.isFree(s, DAY), false);
  });

  it('读档：版本不对开新档，缺的字段补默认值', () => {
    const s = PlayerData.load({ version: -1 }, ECO);
    assert.equal(s.level, 1);
    const raw = JSON.parse(JSON.stringify(PlayerData.create(ECO))) as Record<string, unknown>;
    delete raw.stars;
    assert.deepEqual(PlayerData.load(raw, ECO).stars, {});
  });
});
