// 示例玩法的关卡（换玩法时整个 core/demo 换掉，见 docs/02）：按 config/levels.json 的参数和关卡号现场生成，不用关卡文件。
// 「三消取块」：几层块叠在一起，点没被压住的块进暂存槽，同样的三个消掉；全部消完过关，暂存槽满了输。
// 生成保证可解：先摆好位置，按「总是取最上面的」排出一个取块顺序，再按这个顺序每三个配同一种图案——照这个顺序点一定能过（ref）。
import type { LevelsConfig } from '../config';
import { Rng } from '../rng/rng';
import { clampi, lerpf, roundi } from '../util';

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

/** 第 id 关是哪一种（id 传 Meta.levelFile 换算后的编号） */
export function kindOf(cfg: LevelsConfig, id: number): LevelKind {
  if (cfg.bossEvery > 0 && id % cfg.bossEvery === 0) return 'boss';
  if (cfg.hardEvery > 0 && id % cfg.hardEvery === 0) return 'hard';
  return 'normal';
}

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

/**
 * 生成第 id 关。ease：连输后降的档（每档少 cfg.easeKinds 种图案）；trayDelta：调试页整体档给暂存槽加减几格
 */
export function generate(cfg: LevelsConfig, id: number, ease = 0, trayDelta = 0): DemoLevel {
  const kind = kindOf(cfg, id);
  const seg = segmentFor(cfg, id);
  const plus = kind === 'boss' ? cfg.boss : kind === 'hard' ? cfg.hard : { kindsPlus: 0, setsPlus: 0 };
  // 难关、超难关之后的那一关放松：少几种图案、组数压到最少（docs/02 第 5 节）
  const rel = cfg.release && kind === 'normal' && id > 1 && kindOf(cfg, id - 1) !== 'normal' ? cfg.release : null;
  const kinds = Math.max(2, seg.kinds + plus.kindsPlus - ease * cfg.easeKinds - (rel ? rel.kindsMinus : 0));
  const sets = rel ? Math.min(rel.sets, seg.sets) : Math.max(1, seg.sets + plus.setsPlus);
  const total = kinds * sets * 3;
  const rng = new Rng((id * 2654435761) >>> 0);
  // 位置：每层是 cols × rows 的格子（单位：半块，块占 2×2），奇数层错开半格、少一行一列。
  // 行数取「所有层加起来放得下」的最小值，块从下往上一层层均分
  const layers = Math.max(1, seg.layers);
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
  const clock = cfg.clock && kind !== 'normal' && id >= cfg.clock.from ? Math.max(cfg.clock.min, roundi(total * cfg.clock.perTile)) : 0;
  const spanX = Math.max(...tiles.map((t) => t.x)) + 2;
  const spanY = Math.max(...tiles.map((t) => t.y)) + 2;
  return { id, kind, kinds, tray: Math.max(3, cfg.tray + trayDelta), clock, spanX, spanY, tiles, ref };
}

/** 估算这一关打完要几秒（点击次数 × tapSec + 完成次数 × doneSec），关卡节奏的验收用（docs/02 第 5 节） */
export function estimateSeconds(cfg: LevelsConfig, lv: DemoLevel): number {
  return lv.tiles.length * cfg.pace.tapSec + (lv.tiles.length / 3) * cfg.pace.doneSec;
}

/** 这种关的时长上限（秒） */
export function paceLimit(cfg: LevelsConfig, kind: LevelKind): number {
  return cfg.pace[kind];
}
