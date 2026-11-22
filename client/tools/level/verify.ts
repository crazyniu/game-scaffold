// 关卡校验（./run.sh level-verify [起] [止]）：每一关都生成得出来、参考解按顺序点一定能过。CI 也跑。
// 示例玩法的关卡是现场生成的；换玩法后改成校验自己的关卡文件（CLAUDE.md：进包的关卡必须可解）。
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LevelsConfig } from '../../assets/scripts/core/config';
import { estimateSeconds, generate, paceLimit } from '../../assets/scripts/core/demo/level';
import * as Rules from '../../assets/scripts/core/demo/rules';
import { GameState, Status } from '../../assets/scripts/core/demo/rules';

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '../../assets/resources/config');
const cfg = JSON.parse(readFileSync(join(CONFIG, 'levels.json'), 'utf8')) as LevelsConfig;
const [from = 1, to = cfg.total] = process.argv.slice(2).map(Number);
let bad = 0;
const slow: string[] = [];
const t0 = Date.now();
for (let id = from; id <= to; id++) {
  for (let ease = 0; ease <= 2; ease++) {
    const lv = generate(cfg, id, ease);
    const s = GameState.fromLevel(lv);
    for (const i of lv.ref) Rules.tap(s, i);
    const sec = estimateSeconds(cfg, lv);
    if (ease === 0 && sec > paceLimit(cfg, lv.kind)) slow.push(`第 ${id} 关（${lv.kind}）约 ${Math.round(sec)} 秒，上限 ${paceLimit(cfg, lv.kind)}`);
    if (s.status !== Status.WON) {
      bad++;
      console.log(`✗ 第 ${id} 关（降 ${ease} 档）参考解没过`);
    }
  }
}
// 单局太长不拦 CI，只提示（docs/02 第 5 节：普通关 40–90 秒、难关 2 分钟、超难关 2 分半以内）
if (slow.length > 0) console.log(`! ${slow.length} 关超过时长上限：\n  ${slow.join('\n  ')}`);
if (bad > 0) {
  console.error(`✗ ${bad} 关有问题`);
  process.exit(1);
}
console.log(`✓ 第 ${from}–${to} 关（含降档变体）都能过（${Date.now() - t0} 毫秒）`);
