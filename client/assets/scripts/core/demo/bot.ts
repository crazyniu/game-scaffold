// 示例玩法的量难度机器人（docs/02 第 5.8 节）：只用屏幕上看得到的信息——哪些块能点、暂存槽里有什么、被压住的块是什么图案
// （示例玩法压住的块也看得见图案）。每一步按「想一步」的规矩挑，偶尔手滑随手点一块（slip），像认真但会失误的真人。
// 它的过关率就是这一关的难度；换玩法时照这个思路写自己玩法的机器人：只看屏幕、会想、会失误，不要用全知的求解器当尺子。
import { Rng } from '../rng/rng';
import { covers, DemoLevel } from './level';
import * as Rules from './rules';
import { GameState, Status } from './rules';

export interface BotOptions {
  /** 每一步随手点的概率（0–1） */
  slip: number;
}

/** 每块被哪些块压着（生成后不变，先算好，打一局只查这张表） */
function coverMap(lv: DemoLevel): number[][] {
  return lv.tiles.map((t, i) => lv.tiles.map((o, j) => (j !== i && covers(o, t) ? j : -1)).filter((j) => j >= 0));
}

/** 每块压着哪些块（coverMap 反过来） */
function overMap(under: number[][]): number[][] {
  const over: number[][] = under.map(() => []);
  under.forEach((us, i) => us.forEach((j) => over[j].push(i)));
  return over;
}

/** 这一步点哪块（没有能点的返回 -1）。机器人代打（devtools/autoPlay.ts）也用它一步步点 */
export function pickTap(s: GameState, rng: Rng, o: BotOptions, under: number[][], over: number[][] = overMap(under)): number {
  const free: number[] = [];
  for (let i = 0; i < s.tiles.length; i++) if (s.alive[i] && under[i].every((j) => !s.alive[j])) free.push(i);
  if (free.length === 0) return -1;
  if (rng.randf() < o.slip) return rng.pick(free);
  const inTray = new Map<number, number>();
  for (const t of s.tray) inTray.set(s.tiles[t].kind, (inTray.get(s.tiles[t].kind) ?? 0) + 1);
  const freeOf = new Map<number, number>();
  for (const i of free) freeOf.set(s.tiles[i].kind, (freeOf.get(s.tiles[i].kind) ?? 0) + 1);
  const room = s.trayCap - s.tray.length;
  let pick = -1;
  let bestScore = -Infinity;
  for (const i of free) {
    const k = s.tiles[i].kind;
    const have = inTray.get(k) ?? 0;
    // 凑满三个最好；凑成两个其次；场上能点的同图案够凑一组、暂存槽放得下，也算好；
    // 新开一种图案要占格子：格子越少越不想开。顺带看点掉它能露出几块
    let score = have === 2 ? 1000 : have === 1 ? 300 : 0;
    if (have === 0 && (freeOf.get(k) ?? 0) >= 3 && room >= 3) score += 200;
    if (have === 0) score -= 400 / Math.max(1, room);
    score += 10 * over[i].filter((j) => s.alive[j] && under[j].every((x) => x === i || !s.alive[x])).length;
    score += rng.randf();
    if (score > bestScore) {
      bestScore = score;
      pick = i;
    }
  }
  return pick;
}

/** 每块被哪些块压着（机器人代打按关卡算一次） */
export function covered(lv: DemoLevel): number[][] {
  return coverMap(lv);
}

/** 打一局（不用道具），赢了返回 true */
export function play(lv: DemoLevel, seed: number, o: BotOptions, under: number[][] = coverMap(lv)): boolean {
  const s = GameState.fromLevel(lv);
  const rng = new Rng((seed * 2654435761 + 12345) >>> 0);
  const over = overMap(under);
  while (s.status === Status.PLAYING) {
    const pick = pickTap(s, rng, o, under, over);
    if (pick < 0) break;
    Rules.tap(s, pick);
  }
  return s.status === Status.WON;
}

/** 打 games 局的过关率（0–1）；seedBase 不同 = 换一组局 */
export function rate(lv: DemoLevel, games: number, o: BotOptions, seedBase = 0): number {
  const under = coverMap(lv);
  let won = 0;
  for (let g = 0; g < games; g++) if (play(lv, seedBase + g, o, under)) won++;
  return won / Math.max(1, games);
}
