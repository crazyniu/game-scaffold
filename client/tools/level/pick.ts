// 挑候选（./run.sh level-pick [起] [止]，docs/02 第 5.8 节）：每关按 levels.json 的参数换种子生成 pick.candidates 个候选，
// 用机器人（core/demo/bot.ts）量，挑最接近这一关目标（targetFor）的，种子编号写进 config/level_seeds.json（游戏按它生成）。
//   --dry     只打报告，不写种子表
//   --probe   不挑，只量现在种子表里那一版的过关率（调 levels.json 的规模、目标前先看现状）
// 示例玩法的关卡是现场生成的，所以只存种子；换成读关卡文件的玩法时，把挑出来的那一版写成关卡文件（core/levelPick.ts 照用）。
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LevelsConfig } from '../../assets/scripts/core/config';
import * as Bot from '../../assets/scripts/core/demo/bot';
import { generate, kindOf, targetFor } from '../../assets/scripts/core/demo/level';
import { pickLevel } from '../../assets/scripts/core/levelPick';

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '../../assets/resources/config');
const cfg = JSON.parse(readFileSync(join(CONFIG, 'levels.json'), 'utf8')) as LevelsConfig;
const SEEDS = join(CONFIG, 'level_seeds.json');
const nums = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number);
const from = nums[0] ?? 1;
const to = nums[1] ?? cfg.total;
const dry = process.argv.includes('--dry');
const probe = process.argv.includes('--probe');
const pc = cfg.pick;
if (!pc) throw new Error('levels.json 里没有 pick（候选数、局数、机器人）');
const table = existsSync(SEEDS) ? (JSON.parse(readFileSync(SEEDS, 'utf8')) as { seeds: Record<string, number> }) : { seeds: {} };
const seeds: Record<string, number> = { ...table.seeds };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const t0 = Date.now();
const gaps: number[] = [];
const far: string[] = [];
for (let id = from; id <= to; id++) {
  const target = targetFor(cfg, id);
  const kind = kindOf(cfg, id);
  if (probe) {
    const r = Bot.rate(generate(cfg, id, 0, 0, seeds[String(id)] ?? 0), pc.checkGames, pc.bot, 100000);
    console.log(`第 ${id} 关 ${kind}：${pct(r)}${target === null ? '' : `（目标 ${pct(target)}）`}`);
    if (target !== null) gaps.push(r - target);
    continue;
  }
  if (target === null) {
    delete seeds[String(id)];
    continue;
  }
  const res = pickLevel({
    target,
    candidates: pc.candidates,
    games: pc.games,
    checkGames: pc.checkGames,
    make: (seed) => generate(cfg, id, 0, 0, seed),
    measure: (lv, games, base) => Bot.rate(lv, games, pc.bot, base),
  });
  if (!res) continue;
  if (res.best.seed === 0) delete seeds[String(id)];
  else seeds[String(id)] = res.best.seed;
  gaps.push(res.rate - target);
  const line = `第 ${id} 关 ${kind}：目标 ${pct(target)} → ${pct(res.rate)}（第 ${res.best.seed} 个候选；候选 ${res.screened.map((x) => Math.round(x * 100)).sort((a, b) => a - b).join(' ')}）`;
  console.log(line);
  if (Math.abs(res.rate - target) > 0.1) far.push(line);
}
if (gaps.length > 0) {
  const within = (d: number) => gaps.filter((g) => Math.abs(g) <= d).length;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  console.log(`\n${gaps.length} 关：离目标 ±5 以内 ${within(0.05)} 关、±10 以内 ${within(0.1)} 关，平均偏 ${Math.round(mean * 100)} 个点（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
}
if (far.length > 0) console.log(`离目标 10 个点以上的（这一段参数太松或太紧，调 levels.json 的 segments）：\n  ${far.join('\n  ')}`);
if (!probe && !dry) {
  const sorted = Object.fromEntries(Object.keys(seeds).sort((a, b) => Number(a) - Number(b)).map((k) => [k, seeds[k]]));
  writeFileSync(SEEDS, JSON.stringify({ _comment: '每关用第几个候选（./run.sh level-pick 挑的，docs/02 第 5.8 节）；没写的用第 0 个', seeds: sorted }, null, 1) + '\n');
  console.log(`写进 config/level_seeds.json（${Object.keys(sorted).length} 关不是第 0 个候选）`);
}
