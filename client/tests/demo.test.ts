// 示例玩法（core/demo）的规则和关卡生成。换玩法时把这个文件换成自己玩法的测试。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Bot from '../assets/scripts/core/demo/bot';
import { covers, estimateSeconds, generate, isRelease, kindOf, paceLimit, targetFor } from '../assets/scripts/core/demo/level';
import { pickLevel } from '../assets/scripts/core/levelPick';
import * as Rules from '../assets/scripts/core/demo/rules';
import { GameState, LoseReason, Status } from '../assets/scripts/core/demo/rules';
import { CONFIG, levels } from './helpers';

const CFG = levels();
/** 每关挑好的候选（./run.sh level-pick） */
const SEEDS = (JSON.parse(readFileSync(join(CONFIG, 'level_seeds.json'), 'utf8')) as { seeds: Record<string, number> }).seeds;
const gen = (id: number, ease = 0) => generate(CFG, id, ease, 0, SEEDS[String(id)] ?? 0);

describe('关卡生成', () => {
  it('每一关都生成得出来：块数是 3 的倍数、每种图案块数是 3 的倍数、参考解按顺序点一定过', () => {
    for (let id = 1; id <= CFG.total; id++) {
      const lv = gen(id);
      assert.equal(lv.tiles.length % 3, 0, `第 ${id} 关块数`);
      const per = new Map<number, number>();
      for (const t of lv.tiles) per.set(t.kind, (per.get(t.kind) ?? 0) + 1);
      for (const [k, n] of per) assert.equal(n % 3, 0, `第 ${id} 关图案 ${k}`);
      const s = GameState.fromLevel(lv);
      for (const i of lv.ref) assert.ok(Rules.tap(s, i).length > 0, `第 ${id} 关参考解点不下去`);
      assert.equal(s.status, Status.WON, `第 ${id} 关参考解没过`);
    }
  });

  it('同一关每次生成一样（关卡号就是种子）', () => {
    assert.deepEqual(generate(CFG, 37), generate(CFG, 37));
  });

  it('难度分 3 档按「放松关、普通关、普通关、难关」轮换：第 8 关起每 4 关一个难关，每 20 关一个超难关', () => {
    assert.deepEqual([4, 7, 8, 9, 10, 11, 12].map((id) => kindOf(CFG, id)), ['normal', 'normal', 'hard', 'normal', 'normal', 'normal', 'hard']);
    assert.equal(kindOf(CFG, CFG.bossEvery), 'boss');
    assert.ok(isRelease(CFG, 9) && isRelease(CFG, 21) && !isRelease(CFG, 10));
    assert.ok(generate(CFG, CFG.bossEvery).kinds > generate(CFG, CFG.bossEvery - 1).kinds);
    assert.ok(generate(CFG, 24).tiles.length > generate(CFG, 23).tiles.length, '难关多一组');
  });

  it('目标：教学关不挑；第 4–9 关缓一档；第 10 关起开始难；放松关多 10 个点', () => {
    const t = CFG.targets!;
    assert.equal(targetFor(CFG, t.tutorialUntil), null);
    assert.equal(targetFor(CFG, 4), t.early!.normal);
    assert.equal(targetFor(CFG, 8), t.early!.hard);
    assert.equal(targetFor(CFG, 10), t.normal);
    assert.equal(targetFor(CFG, 12), t.hard);
    assert.equal(targetFor(CFG, 20), t.boss);
    assert.equal(targetFor(CFG, 21), t.normal + t.releasePlus);
  });

  it('单局时长不超过这种关的上限（docs/02 第 5 节）', () => {
    for (let id = 1; id <= CFG.total; id++) {
      const lv = gen(id);
      assert.ok(estimateSeconds(CFG, lv) <= paceLimit(CFG, lv.kind), `第 ${id} 关估算 ${Math.round(estimateSeconds(CFG, lv))} 秒`);
    }
  });

  it('难关、超难关之后的那一关放松：图案比再下一个普通关少', () => {
    for (let h = 24; h + 2 <= CFG.total; h += CFG.hardEvery) {
      const relax = generate(CFG, h + 1);
      const next = generate(CFG, h + 2);
      assert.ok(relax.kinds < next.kinds, `第 ${h + 1} 关不比第 ${h + 2} 关松`);
    }
  });

  it('第 41 关起难度持平：普通关的图案数、块数都一样', () => {
    const base = generate(CFG, 42);
    for (let id = 42; id <= CFG.total; id++) {
      const lv = generate(CFG, id);
      if (lv.kind !== 'normal' || kindOf(CFG, id - 1) !== 'normal') continue;
      assert.equal(lv.kinds, base.kinds, `第 ${id} 关`);
      assert.equal(lv.tiles.length, base.tiles.length, `第 ${id} 关`);
    }
  });

  it('连输降档：少一种图案', () => {
    assert.equal(generate(CFG, 30, 1).kinds, generate(CFG, 30, 0).kinds - CFG.easeKinds);
  });
});

describe('挑候选（docs/02 第 5.8 节）', () => {
  it('挑复量最接近目标的候选；初量离目标近的先复量', () => {
    // 假的关卡：候选 seed 的「真实」过关率是 seed / 10，初量偏 3 个点（模拟只打几局的误差）
    const res = pickLevel({
      target: 0.42,
      candidates: 10,
      games: 10,
      checkGames: 100,
      make: (seed) => seed,
      measure: (lv, games) => (games === 10 ? lv / 10 + 0.03 : lv / 10),
    });
    assert.ok(res);
    assert.equal(res.best.seed, 4);
    assert.equal(res.rate, 0.4);
    assert.equal(res.screened.length, 10);
  });

  it('生成不出来的种子跳过，一个都没有返回 null', () => {
    assert.equal(pickLevel({ target: 0.5, candidates: 3, games: 1, checkGames: 1, make: () => null, measure: () => 0 }), null);
    const res = pickLevel({ target: 0.5, candidates: 2, games: 1, checkGames: 1, make: (s) => (s % 2 === 0 ? null : s), measure: () => 0.5 });
    assert.deepEqual(res?.screened, [0.5, 0.5]);
  });

  it('机器人：同一局每次一样；手滑越多越难过；种子表里的候选都在范围内', () => {
    const lv = gen(30);
    assert.equal(Bot.play(lv, 3, { slip: 0.1 }), Bot.play(lv, 3, { slip: 0.1 }));
    assert.ok(Bot.rate(lv, 40, { slip: 0 }) >= Bot.rate(lv, 40, { slip: 0.6 }));
    for (const [id, v] of Object.entries(SEEDS)) {
      assert.ok(Number(id) > CFG.targets!.tutorialUntil && Number(id) <= CFG.total, `第 ${id} 关`);
      assert.ok(Number.isInteger(v) && v > 0 && v < CFG.pick!.candidates * 3, `第 ${id} 关第 ${v} 个`);
    }
  });
});

describe('规则', () => {
  it('被压住的块点不了', () => {
    const lv = generate(CFG, 30);
    const s = GameState.fromLevel(lv);
    const covered = lv.tiles.findIndex((t, i) => lv.tiles.some((o, j) => j !== i && covers(o, t)));
    assert.ok(covered >= 0);
    assert.deepEqual(Rules.tap(s, covered), []);
  });

  it('同样的三个消掉；暂存槽满了输', () => {
    const lv = generate(CFG, 1);
    const s = GameState.fromLevel(lv);
    const ev = [lv.ref[0], lv.ref[1], lv.ref[2]].flatMap((i) => Rules.tap(s, i));
    assert.ok(ev.some((e) => e.type === 'clear'));
    assert.equal(s.tray.length, 0);
    // 塞满：每次挑一块和暂存槽里都不一样的
    const t = GameState.fromLevel(generate(CFG, 61));
    t.trayCap = 3;
    while (t.status === Status.PLAYING) {
      const free = t.freeTiles().filter((i) => !t.tray.some((x) => t.tiles[x].kind === t.tiles[i].kind));
      if (free.length === 0) break;
      Rules.tap(t, free[0]);
    }
    assert.equal(t.status, Status.LOST);
    assert.equal(t.loseReason, LoseReason.TRAY_FULL);
  });

  it('复活：最后三块放回场上，接着玩', () => {
    const s = GameState.fromLevel(generate(CFG, 61));
    s.trayCap = 3;
    while (s.status === Status.PLAYING) {
      const free = s.freeTiles().filter((i) => !s.tray.some((x) => s.tiles[x].kind === s.tiles[i].kind));
      Rules.tap(s, free[0]);
    }
    Rules.revive(s);
    assert.equal(s.status, Status.PLAYING);
    assert.equal(s.tray.length, 0);
    assert.ok(s.revived);
  });

  it('限时关到点就输', () => {
    const s = GameState.fromLevel(generate(CFG, 1));
    s.clock = 1;
    Rules.tick(s, 0.5);
    assert.equal(s.status, Status.PLAYING);
    Rules.tick(s, 0.6);
    assert.equal(s.loseReason, LoseReason.CLOCK);
  });

  it('洗牌只换图案，块数和每种的数量不变', () => {
    const s = GameState.fromLevel(generate(CFG, 40));
    const before = s.tiles.map((t) => t.kind).sort();
    Rules.useShuffle(s, 123);
    assert.deepEqual(s.tiles.map((t) => t.kind).sort(), before);
  });

  it('提示优先给能凑满三个的', () => {
    const lv = generate(CFG, 1);
    const s = GameState.fromLevel(lv);
    Rules.tap(s, lv.ref[0]);
    Rules.tap(s, lv.ref[1]);
    const h = Rules.hint(s);
    assert.equal(s.tiles[h].kind, s.tiles[lv.ref[0]].kind);
  });
});
