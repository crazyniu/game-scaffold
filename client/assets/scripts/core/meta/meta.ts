// 局外规则里零散的几项：关卡循环、连败降难度、免费金币、广告频控。
// 全部是对存档的纯计算；日期、时间、随机数由调用方传入。
import type { AdsConfig, EconomyConfig } from '../config';
import { idiv, posmod } from '../util';
import * as Daily from './daily';
import type { SaveData } from './save';

/**
 * 第 id 关用哪一关的内容。count 是关卡总数；超过后只在后一半里循环（总数 120 时：第 121 关起循环第 61–120 关）。
 * 后一半的长度取难关间隔的整数倍，难关的位置就不变
 */
export function levelFile(id: number, count: number): number {
  if (id <= count) return id;
  const half = idiv(count, 2);
  return half + 1 + posmod(id - count - 1, count - half);
}

/**
 * 第 id 关是第几轮：前 count 关是第 1 轮，之后后一半每循环一遍加一轮（第 361–540 关第 2 轮，541–720 第 3 轮……）。
 * 地图上「第 N 轮」用
 */
export function loopRound(id: number, count: number): number {
  if (id <= count) return 1;
  return 2 + idiv(id - count - 1, count - idiv(count, 2));
}

/** 失败记一次，返回下次该用的易化档位（0 = 普通） */
export function failLevel(save: SaveData, eco: EconomyConfig, levelId: number): number {
  const fails = save.fails;
  if (fails.level !== levelId) {
    fails.level = levelId;
    fails.count = 0;
  }
  fails.count += 1;
  return easeFor(save, eco, levelId);
}

export function easeFor(save: SaveData, eco: EconomyConfig, levelId: number): number {
  if (save.fails.level !== levelId) return 0;
  let ease = 0;
  for (const threshold of eco.easeAfterFails) if (save.fails.count >= threshold) ease++;
  return ease;
}

/** 今天看广告领金币还剩几次 */
export function freeCoinLeft(save: SaveData, eco: EconomyConfig, day: number): number {
  Daily.roll(save, day);
  return Math.max(eco.freeCoin.daily - save.daily.freeCoin, 0);
}

/** 看完广告领金币（rv_free_coin）。次数用完返回 false */
export function takeFreeCoin(save: SaveData, eco: EconomyConfig, day: number): boolean {
  Daily.roll(save, day);
  if (save.daily.freeCoin >= eco.freeCoin.daily) return false;
  save.daily.freeCoin += 1;
  save.coins += eco.freeCoin.amount;
  return true;
}

/** 这一关的结算页、暂停弹窗底部放不放 Banner（前几关不出广告） */
export function shouldShowBanner(ads: AdsConfig, levelId: number): boolean {
  return levelId >= (ads.banner?.minLevel ?? 0);
}

/** 过关后该不该弹插屏。now 是单调递增的秒数 */
export function shouldShowInterstitial(save: SaveData, ads: AdsConfig, levelId: number, now: number): boolean {
  const rule = ads.interstitial;
  const st = save.ads;
  return (
    levelId >= rule.minLevel &&
    now - st.interstitialAt >= rule.minSeconds &&
    levelId - st.interstitialLevel >= rule.minLevelsBetween &&
    now - st.rewardedAt >= rule.skipAfterRewardedSeconds
  );
}

export function markInterstitial(save: SaveData, levelId: number, now: number): void {
  save.ads.interstitialAt = now;
  save.ads.interstitialLevel = levelId;
}

export function markRewarded(save: SaveData, now: number): void {
  save.ads.rewardedAt = now;
}
