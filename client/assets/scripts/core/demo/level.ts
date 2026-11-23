// 示例玩法的关卡（换玩法时整个 core/demo 换掉，见 docs/02）：按 config/levels.json 的参数和关卡号现场生成，不用关卡文件。
// 「三消取块」：几层块叠在一起，点没被压住的块进暂存槽，同样的三个消掉；全部消完过关，暂存槽满了输。
// 生成保证可解：先摆好位置，按「总是取最上面的」排出一个取块顺序，再按这个顺序每三个配同一种图案——照这个顺序点一定能过（ref）。
import type { LevelsConfig } from '../config';
import { Rng } from '../rng/rng';
import { clampi, lerpf, roundi } from '../util';
import { planTemplates, templateName, tierOf } from '../levelTemplates';

export type LevelKind = 'normal' | 'hard' | 'boss';

export interface Tile {
  /** 格子坐标（单位：半个块宽），层越高越靠上 */
  x: number;
  y: number;
  layer: number;
  kind: number;
}

export interface DemoLevel {
  id: number;
  kind: LevelKind;
  /** 几种图案 */
  kinds: number;
  tray: number;
  /** 整关限时秒数，0 = 不限时 */
  clock: number;
  /** 所有块占的范围（单位：半个块宽）：界面按它缩放居中 */
  spanX: number;
  spanY: number;
  tiles: Tile[];
  /** 参考解：按这个顺序点一定能过（测试、演示、机器人代打用） */
  ref: number[];
}

/**
 * 第 id 关是哪一种（id 传 Meta.levelFile 换算后的编号）。难度分 3 档、按「放松关、普通关、普通关、难关」轮换（docs/02 第 5 节）：
 * 第 hardFrom 关起每 hardEvery 关一个难关，每 bossEvery 关的难关是超难关；难关后面那一关是放松关（isRelease）
 */
export function kindOf(cfg: LevelsConfig, id: number): LevelKind {
  if (id < (cfg.hardFrom ?? 0)) return 'normal';
  if (cfg.bossEvery > 0 && id % cfg.bossEvery === 0) return 'boss';
  if (cfg.hardEvery > 0 && id % cfg.hardEvery === 0) return 'hard';
  return 'normal';
}

/** 难关、超难关之后的那一关（配了 release 才有） */
export function isRelease(cfg: LevelsConfig, id: number): boolean {
  return cfg.release !== undefined && id > 1 && kindOf(cfg, id) === 'normal' && kindOf(cfg, id - 1) !== 'normal';
}

/** 第 id 关是哪一档难度（docs/02 第 5.9 节）；教学期、没配 tiers 返回 null */
export function tierFor(cfg: LevelsConfig, id: number): string | null {
  if (!cfg.tiers || !cfg.mix) return null;
  return tierOf(cfg.mix, id, kindOf(cfg, id) === 'boss');
}

/**
 * 这一关机器人（core/demo/bot.ts）不用道具的过关率目标（0–1，docs/02 第 5.8、5.9 节）；教学关返回 null（不挑，用第 0 个种子）。
 * 有档的关照档的目标；没配 tiers 时按关卡类型取 normal / hard / boss，放松关加 releasePlus
 */
export function targetFor(cfg: LevelsConfig, id: number): number | null {
  const t = cfg.targets;
  if (!t || id <= t.tutorialUntil) return null;
  const tier = tierFor(cfg, id);
  if (tier && cfg.tiers) return cfg.tiers[tier].target;
  const kind = kindOf(cfg, id);
  if (t.early && id <= t.early.until) return kind === 'normal' ? t.early.normal : t.early.hard;
  const base = kind === 'boss' ? t.boss : kind === 'hard' ? t.hard : t.normal;
  return Math.min(0.95, base + (isRelease(cfg, id) ? t.releasePlus : 0));
}

/** 每关挑好的候选（config/level_seeds.json，./run.sh level-pick 写）：seeds 是逐关生成的关，templates 是模板（档_第几个） */
export interface LevelSeeds {
  seeds: Record<string, number>;
  templates?: Record<string, number>;
}
export const NO_SEEDS: LevelSeeds = { seeds: {} };

function segmentFor(cfg: LevelsConfig, id: number): { kinds: number; sets: number; layers: number } {
  const segs = cfg.segments;
  let i = 0;
  while (i + 1 < segs.length && id >= segs[i + 1].from) i++;
  const s = segs[i];
  const to = i + 1 < segs.length ? segs[i + 1].from - 1 : cfg.total;
  const t = to > s.from ? clampi((id - s.from) / (to - s.from), 0, 1) : 0;
  return { kinds: roundi(lerpf(s.kinds[0], s.kinds[1], t)), sets: roundi(lerpf(s.sets[0], s.sets[1], t)), layers: s.layers };
}

/** 一块压住另一块：上层、而且两块有重叠（坐标差都小于 2 个半块） */
export function covers(a: Tile, b: Tile): boolean {
  return a.layer > b.layer && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
}

/** 第 id 关从哪个模板来（第 templatesFrom 关以前、没配模板返回 null） */
export function templateFor(cfg: LevelsConfig, id: number): { tier: string; slot: number } | null {
  if (!cfg.tiers || cfg.templatesFrom === undefined || id < cfg.templatesFrom) return null;
  const counts = Object.fromEntries(Object.entries(cfg.tiers).map(([k, t]) => [k, t.count]));
  return planTemplates(counts, (x) => tierFor(cfg, x), cfg.templatesFrom, id).get(id) ?? null;
}

/**
 * 生成第 id 关。ease：连输后降的档（每档少 cfg.easeKinds 种图案）；trayDelta：调试页整体档给暂存槽加减几格；
 * seeds：挑好的候选（config/level_seeds.json）。第 templatesFrom 关起从这一档的模板来（templateFor），换图案、左右镜像
 */
export function generate(cfg: LevelsConfig, id: number, ease = 0, trayDelta = 0, seeds: LevelSeeds = NO_SEEDS): DemoLevel {
  const kind = kindOf(cfg, id);
  const tpl = templateFor(cfg, id);
  if (tpl) return transform(cfg, generateTemplate(cfg, tpl.tier, tpl.slot, ease, trayDelta, seeds.templates?.[templateName(tpl.tier, tpl.slot)] ?? 0), id);
  const seg = segmentFor(cfg, id);
  const plus = kind === 'boss' ? cfg.boss : kind === 'hard' ? cfg.hard : { kindsPlus: 0, setsPlus: 0 };
  // 难关、超难关之后的那一关放松：少几种图案，内容不减（docs/02 第 5 节）
  const rel = isRelease(cfg, id) ? cfg.release : null;
  const kinds = Math.max(2, seg.kinds + plus.kindsPlus - ease * cfg.easeKinds - (rel ? rel.kindsMinus : 0));
  const sets = Math.max(1, seg.sets + plus.setsPlus);
  return build(cfg, id, kind, kinds, sets, seg.layers, trayDelta, (id * 2654435761 + (seeds.seeds[String(id)] ?? 0) * 40503) >>> 0);
}

/** 一档的第 slot 个模板（variant = 挑好的第几个候选）：规模照这一档，种子只看档和第几个 */
export function generateTemplate(cfg: LevelsConfig, tier: string, slot: number, ease = 0, trayDelta = 0, variant = 0): DemoLevel {
  const t = cfg.tiers?.[tier];
  if (!t) throw new Error(`levels.json 的 tiers 里没有 ${tier}`);
  const key = 1000000 + Object.keys(cfg.tiers ?? {}).indexOf(tier) * 1000 + slot;
  return build(cfg, key, 'normal', Math.max(2, t.kinds - ease * cfg.easeKinds), t.sets, t.layers, trayDelta, (key * 2654435761 + variant * 40503) >>> 0);
}

/**
 * 模板变成第 id 关：图案整体换一遍（参考解、难度都不变），左右镜像（谁压着谁不变），关卡类型、限时照这一关。
 * 同一关每次换法一样（种子只看关卡号）
 */
export function transform(cfg: LevelsConfig, lv: DemoLevel, id: number): DemoLevel {
  const rng = new Rng((id * 7919 + 13) >>> 0);
  const perm = Array.from({ length: lv.kinds }, (_, i) => i);
  rng.shuffle(perm);
  const tiles = lv.tiles.map((t) => ({ ...t, kind: perm[t.kind], x: lv.spanX - 2 - t.x }));
  const kind = kindOf(cfg, id);
  return { ...lv, id, kind, tiles, ref: lv.ref.slice(), clock: clockFor(cfg, kind, id, tiles.length) };
}

function clockFor(cfg: LevelsConfig, kind: LevelKind, id: number, total: number): number {
  return cfg.clock && kind !== 'normal' && id >= cfg.clock.from ? Math.max(cfg.clock.min, roundi(total * cfg.clock.perTile)) : 0;
}

/** 按规模摆一关（按解构造，保证可解）：seed 定位置、取块顺序和图案 */
function build(cfg: LevelsConfig, id: number, kind: LevelKind, kinds: number, sets: number, layersIn: number, trayDelta: number, seed: number): DemoLevel {
  const total = kinds * sets * 3;
  const rng = new Rng(seed);
  // 位置：每层是 cols × rows 的格子（单位：半块，块占 2×2），奇数层错开半格、少一行一列。
  // 行数取「所有层加起来放得下」的最小值，块从下往上一层层均分
  const layers = Math.max(1, layersIn);
  const cols = 6;
  const cap = (r: number, L: number): number => (L % 2 === 0 ? cols * r : (cols - 1) * (r - 1));
  let rows = 3;
  while (Array.from({ length: layers }, (_, L) => cap(rows, L)).reduce((a, b) => a + b, 0) < total) rows++;
  const tiles: Tile[] = [];
  for (let L = 0; L < layers; L++) {
    const off = L % 2;
    const cells: [number, number][] = [];
    for (let r = 0; r < rows - off; r++) for (let c = 0; c < cols - off; c++) cells.push([c * 2 + off, r * 2 + off]);
    rng.shuffle(cells);
    // 剩下的块按剩下的层均分；放不满的层由上面的层补
    const restCap = Array.from({ length: layers - L - 1 }, (_, k) => cap(rows, L + 1 + k)).reduce((a, b) => a + b, 0);
    const want = Math.ceil((total - tiles.length) / (layers - L));
    const n = Math.min(cells.length, Math.max(want, total - tiles.length - restCap));
    for (let i = 0; i < n; i++) tiles.push({ x: cells[i][0], y: cells[i][1], layer: L, kind: -1 });
  }
  // 取块顺序：每次从没被压住的块里随机挑一个
  const left = tiles.map((_, i) => i);
  const ref: number[] = [];
  while (left.length > 0) {
    const free = left.filter((i) => !left.some((j) => j !== i && covers(tiles[j], tiles[i])));
    const pick = rng.pick(free);
    ref.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  // 按取块顺序每三个配一种图案（图案的先后打乱）
  const order: number[] = [];
  for (let k = 0; k < kinds; k++) for (let s = 0; s < sets; s++) order.push(k);
  rng.shuffle(order);
  ref.forEach((t, i) => (tiles[t].kind = order[Math.floor(i / 3)]));
  const spanX = Math.max(...tiles.map((t) => t.x)) + 2;
  const spanY = Math.max(...tiles.map((t) => t.y)) + 2;
  return { id, kind, kinds, tray: Math.max(3, cfg.tray + trayDelta), clock: clockFor(cfg, kind, id, total), spanX, spanY, tiles, ref };
}

/** 估算这一关打完要几秒（点击次数 × tapSec + 完成次数 × doneSec），关卡节奏的验收用（docs/02 第 5 节） */
export function estimateSeconds(cfg: LevelsConfig, lv: DemoLevel): number {
  return lv.tiles.length * cfg.pace.tapSec + (lv.tiles.length / 3) * cfg.pace.doneSec;
}

/** 这种关的时长上限（秒） */
export function paceLimit(cfg: LevelsConfig, kind: LevelKind): number {
  return cfg.pace[kind];
}
