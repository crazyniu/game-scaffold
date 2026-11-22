// 示例玩法（core/demo）的规则和关卡生成。换玩法时把这个文件换成自己玩法的测试。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { covers, estimateSeconds, generate, kindOf, paceLimit } from '../assets/scripts/core/demo/level';
import * as Rules from '../assets/scripts/core/demo/rules';
import { GameState, LoseReason, Status } from '../assets/scripts/core/demo/rules';
import { levels } from './helpers';

const CFG = levels();

describe('关卡生成', () => {
  it('每一关都生成得出来：块数是 3 的倍数、每种图案块数是 3 的倍数、参考解按顺序点一定过', () => {
    for (let id = 1; id <= CFG.total; id++) {
      const lv = generate(CFG, id);
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

  it('难关、超难关按间隔出现，图案更多', () => {
    assert.equal(kindOf(CFG, CFG.hardEvery), 'hard');
    assert.equal(kindOf(CFG, CFG.bossEvery), 'boss');
    assert.equal(kindOf(CFG, CFG.hardEvery + 1), 'normal');
    assert.ok(generate(CFG, CFG.bossEvery).kinds > generate(CFG, CFG.bossEvery - 1).kinds);
  });

  it('单局时长不超过这种关的上限（docs/02 第 5 节）', () => {
    for (let id = 1; id <= CFG.total; id++) {
      const lv = generate(CFG, id);
      assert.ok(estimateSeconds(CFG, lv) <= paceLimit(CFG, lv.kind), `第 ${id} 关估算 ${Math.round(estimateSeconds(CFG, lv))} 秒`);
    }
  });

  it('难关、超难关之后的那一关放松：比前后的普通关都短', () => {
    // 教学期的关本来就小，从第 21 关起看每一个难关前后
    for (let h = 25; h + 1 <= CFG.total; h += CFG.hardEvery) {
      const before = generate(CFG, h - 1);
      const after = generate(CFG, h + 1);
      assert.ok(after.tiles.length < before.tiles.length, `第 ${h + 1} 关不比第 ${h - 1} 关短`);
    }
  });

  it('连输降档：少一种图案', () => {
    assert.equal(generate(CFG, 30, 1).kinds, generate(CFG, 30, 0).kinds - CFG.easeKinds);
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
