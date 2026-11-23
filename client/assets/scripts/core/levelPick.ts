// 关卡难度的生成方式「挑候选」（docs/02 第 5.8 节），和具体玩法无关，换玩法也照用：
// 每关按这一关的参数换种子生成 candidates 个候选（生成出来就保证可解），用只看屏幕的机器人各打 games 局，
// 离目标最近的几个换一组种子复量 checkGames 局（只用一组种子挑，挑出来的会偏向「刚好碰上那几局」），按复量的数取最接近目标的。
// 不逐关换块收紧：准度差不多、快一个数量级，上千关也生成得完。候选都比目标容易得多说明这一段的参数（规模、种数、层数）太松，
// 该调参数，不该硬收紧。

export interface Candidate<L> {
  /** 第几个候选（生成时的种子编号，存进关卡种子表） */
  seed: number;
  level: L;
  /** 初量的过关率 */
  rate: number;
}

export interface PickOptions<L> {
  /** 目标过关率（0–1） */
  target: number;
  /** 生成几个候选 */
  candidates: number;
  /** 生成第 seed 个候选；生成不出来返回 null（换下一个种子，最多试 candidates × 3 个） */
  make: (seed: number) => L | null;
  /** 机器人打 games 局的过关率（0–1）；seedBase 不同 = 换一组局 */
  measure: (level: L, games: number, seedBase: number) => number;
  /** 初量每个候选几局 */
  games: number;
  /** 复量几局 */
  checkGames: number;
  /** 最多复量几个候选（按初量离目标从近到远；复量到 close 以内就停） */
  recheck?: number;
  /** 复量离目标这么近就不再往下复量（默认 0.05） */
  close?: number;
}

export interface PickResult<L> {
  best: Candidate<L>;
  /** best 复量的过关率 */
  rate: number;
  /** 所有候选初量的过关率（报告用） */
  screened: number[];
}

/** 复量用的种子组，和初量的错开 */
export const CHECK_SEED_BASE = 100000;

export function pickLevel<L>(o: PickOptions<L>): PickResult<L> | null {
  const cands: Candidate<L>[] = [];
  for (let seed = 0; cands.length < o.candidates && seed < o.candidates * 3; seed++) {
    const level = o.make(seed);
    if (level !== null) cands.push({ seed, level, rate: o.measure(level, o.games, 0) });
  }
  if (cands.length === 0) return null;
  const close = o.close ?? 0.05;
  const order = [...cands].sort((a, b) => Math.abs(a.rate - o.target) - Math.abs(b.rate - o.target) || a.seed - b.seed);
  let best: Candidate<L> | null = null;
  let bestRate = 0;
  for (const c of order.slice(0, Math.max(1, o.recheck ?? 4))) {
    const r = o.measure(c.level, o.checkGames, CHECK_SEED_BASE);
    if (best === null || Math.abs(r - o.target) < Math.abs(bestRate - o.target)) {
      best = c;
      bestRate = r;
    }
    if (Math.abs(bestRate - o.target) <= close) break;
  }
  return { best: best as Candidate<L>, rate: bestRate, screened: cands.map((c) => c.rate) };
}
