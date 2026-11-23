// 示例玩法（core/demo）的规则和关卡生成。换玩法时把这个文件换成自己玩法的测试。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Bot from '../assets/scripts/core/demo/bot';
import { covers, estimateSeconds, generate, generateTemplate, isRelease, kindOf, LevelSeeds, paceLimit, targetFor, templateFor, tierFor, transform } from '../assets/scripts/core/demo/level';
import { pickLevel } from '../assets/scripts/core/levelPick';
import * as Rules from '../assets/scripts/core/demo/rules';
import { GameState, LoseReason, Status } from '../assets/scripts/core/demo/rules';
import { CONFIG, levels } from './helpers';

const CFG = levels();
/** 每关挑好的候选（./run.sh level-pick） */
const TABLE = JSON.parse(readFileSync(join(CONFIG, 'level_seeds.json'), 'utf8')) as LevelSeeds;
const SEEDS = TABLE.seeds;
const gen = (id: number, ease = 0) => generate(CFG, id, ease, 0, TABLE);

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

  it('关卡类型：第 8 关起每 4 关一个难关，每 20 关一个超难关，难关后面那一关是放松位', () => {
    assert.deepEqual([4, 7, 8, 9, 10, 11, 12].map((id) => kindOf(CFG, id)), ['normal', 'normal', 'hard', 'normal', 'normal', 'normal', 'hard']);
    assert.equal(kindOf(CFG, CFG.bossEvery), 'boss');
    assert.ok(isRelease(CFG, 9) && isRelease(CFG, 21) && !isRelease(CFG, 10));
  });

  it('难度 5 档（docs/02 5.9）：前 5 关教学；第 5–50 关 5 档都出现；50 关以后没有放松；目标照档；越往后难的档越多', () => {
    const tiers = CFG.tiers!;
    for (let id = 1; id <= CFG.targets!.tutorialUntil; id++) assert.equal(targetFor(CFG, id), null, `第 ${id} 关是教学`);
    const seen = new Set<string>();
    for (let id = 5; id <= 50; id++) seen.add(String(tierFor(CFG, id)));
    for (const k of Object.keys(tiers)) assert.ok(seen.has(k), `第 5–50 关没有 ${tiers[k].name}`);
    for (let id = 51; id <= CFG.total; id++) assert.notEqual(tierFor(CFG, id), 't1', `第 ${id} 关`);
    for (let id = 6; id <= CFG.total; id++) assert.equal(targetFor(CFG, id), tiers[tierFor(CFG, id) as string].target, `第 ${id} 关`);
    const hardShare = (a: number, b: number) => {
      let n = 0;
      for (let id = a; id <= b; id++) if (['t3', 't4', 't5'].includes(String(tierFor(CFG, id)))) n++;
      return n / (b - a + 1);
    };
    assert.ok(hardShare(81, 120) > hardShare(21, 40), '后面难的档更多');
  });

  it('模板（docs/02 5.9）：第 templatesFrom 关起从模板来；换图案、镜像以后参考解照样过、每种图案块数不变；同一个模板前后至少隔 templateGap 关', () => {
    const from = CFG.templatesFrom!;
    assert.equal(templateFor(CFG, from - 1), null);
    const uses = new Map<string, number[]>();
    for (let id = from; id <= CFG.total; id++) {
      const t = templateFor(CFG, id)!;
      assert.equal(t.tier, tierFor(CFG, id));
      const k = `${t.tier}_${t.slot}`;
      uses.set(k, [...(uses.get(k) ?? []), id]);
    }
    for (const [k, ids] of uses) for (let i = 1; i < ids.length; i++) assert.ok(ids[i] - ids[i - 1] >= CFG.templateGap!, `${k}：${ids.join(' ')}`);
    assert.equal(uses.size, Object.values(CFG.tiers!).reduce((n, t) => n + t.count, 0), '每个模板都用上');
    // 同一个模板的两关：结构一样（块数、层），图案换过
    const [a, b] = [...uses.values()].find((ids) => ids.length >= 2)!;
    const la = gen(a);
    const lb = gen(b);
    assert.equal(la.tiles.length, lb.tiles.length);
    assert.notDeepEqual(la.tiles.map((t) => t.kind), lb.tiles.map((t) => t.kind));
    const base = generateTemplate(CFG, 't2', 0);
    const out = transform(CFG, base, 77);
    const s = GameState.fromLevel(out);
    for (const i of out.ref) Rules.tap(s, i);
    assert.equal(s.status, Status.WON, '换完参考解照样过');
  });

  it('单局时长不超过这种关的上限（docs/02 第 5 节）', () => {
    for (let id = 1; id <= CFG.total; id++) {
      const lv = gen(id);
      assert.ok(estimateSeconds(CFG, lv) <= paceLimit(CFG, lv.kind), `第 ${id} 关估算 ${Math.round(estimateSeconds(CFG, lv))} 秒`);
    }
  });

  it('同一档的关规模一样（模板关）：块数照这一档', () => {
    for (let id = CFG.templatesFrom!; id <= CFG.total; id++) {
      const t = CFG.tiers![tierFor(CFG, id) as string];
      assert.equal(gen(id).tiles.length, t.kinds * t.sets * 3, `第 ${id} 关`);
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
