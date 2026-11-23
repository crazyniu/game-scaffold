// 5 档难度 + 模板复用（docs/02 第 5.9 节），和具体玩法无关，换玩法也照用：
// - 难度只分几档（放松、普通、难、很难、超难），每档一个固定的过关率目标；越往后难的档越多（mix：四关一轮的档位配比），这样加难，不改关卡。
// - 教学期以后，每档只生成几个「模板」（每个模板挑一次难度），每一关从它这一档里挑一个最久没用的模板，换图案、换摆法得来——
//   难度和模板一模一样，不用再量。改难度：重挑某一档的模板，或者改 mix。关卡要多少有多少。

/** mix 的一行：[从第几关起, 四关一轮的档（八项 = 两轮交替）, 超难关（每章最后一关）用的档] */
export type MixRow = [number, string[], string];

/** 第 id 关是哪一档；mix 的第一行以前（教学期）返回 null */
export function tierOf(mix: readonly MixRow[], id: number, isBoss: boolean): string | null {
  if (mix.length === 0 || id < mix[0][0]) return null;
  let row = mix[0];
  for (const r of mix) if (id >= r[0]) row = r;
  if (isBoss) return row[2];
  return row[1][(id - 1) % row[1].length];
}

export const templateName = (tier: string, slot: number): string => `${tier}_${slot}`;

/**
 * 第 from 关起每关用哪个模板（{档, 第几个}）：同一档里挑最久没用的那个，排到 upto 关。
 * 只看关卡号，从 from 一路算下来，所以结果和从哪一关开始读无关
 */
export function planTemplates(counts: Readonly<Record<string, number>>, tierAt: (id: number) => string | null, from: number, upto: number): Map<number, { tier: string; slot: number }> {
  const out = new Map<number, { tier: string; slot: number }>();
  const last = new Map<string, number>();
  for (let id = from; id <= upto; id++) {
    const tier = tierAt(id);
    if (!tier) continue;
    const n = Math.max(1, counts[tier] ?? 1);
    let best = 0;
    let bestAt = Infinity;
    for (let s = 0; s < n; s++) {
      const at = last.get(templateName(tier, s)) ?? -Infinity;
      if (at < bestAt) {
        bestAt = at;
        best = s;
      }
    }
    last.set(templateName(tier, best), id);
    out.set(id, { tier, slot: best });
  }
  return out;
}
