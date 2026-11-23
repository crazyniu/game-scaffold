// 配置表：assets/resources/config 下的 JSON（数值只在这里，CLAUDE.md 硬性约束 5）。启动时读一次。
import { JsonAsset, resources } from 'cc';
import type { AdsConfig, CardDef, EconomyConfig, GameUiConfig, LevelsConfig } from '../core/config';
import { DemoLevel, generate, kindOf } from '../core/demo/level';
import { lab } from '../devtools/levelLab';

function describe(v: unknown): string {
  if (typeof v !== 'object' || v === null) return String(v);
  const o = v as Record<string, unknown>;
  return `${v.constructor?.name} keys=${Object.keys(o).join(',')} json=${typeof o.json}`;
}

export function loadJson<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    resources.load(path, JsonAsset, (err: Error | null, asset: JsonAsset) => {
      // 成功时 Cocos 传的 err 是 undefined 而不是声明里的 null，只能按真假判断
      if (err) reject(err);
      else if (asset === null || asset === undefined || asset.json === null || asset.json === undefined)
        reject(new Error(`配置表读不出来: ${path}（${describe(asset)}）`));
      else resolve(asset.json as T);
    });
  });
}

export class Config {
  eco!: EconomyConfig;
  ads!: AdsConfig;
  levels!: LevelsConfig;
  /** 每关用第几个候选（config/level_seeds.json，./run.sh level-pick 挑的；docs/02 第 5.8 节） */
  seeds: Record<string, number> = {};
  ui!: GameUiConfig;
  cards: CardDef[] = [];
  cardById = new Map<string, CardDef>();

  async load(): Promise<void> {
    const [eco, ads, levels, cards, ui, seeds] = await Promise.all([
      loadJson<EconomyConfig>('config/economy'),
      loadJson<AdsConfig>('config/ads'),
      loadJson<LevelsConfig>('config/levels'),
      loadJson<{ cards: CardDef[] }>('config/cards'),
      loadJson<GameUiConfig>('config/game_ui'),
      loadJson<{ seeds: Record<string, number> }>('config/level_seeds'),
    ]);
    this.seeds = seeds.seeds;
    this.ui = ui;
    this.eco = eco;
    this.ads = ads;
    this.levels = levels;
    this.cards = cards.cards;
    for (const c of this.cards) this.cardById.set(c.id, c);
  }

  /** 关卡总数（之后在后半段循环，见 Meta.levelFile） */
  get levelCount(): number {
    return this.levels.total;
  }

  /** 第 fileId 关是普通关、难关还是超难关 */
  kindOf(fileId: number): 'normal' | 'hard' | 'boss' {
    return kindOf(this.levels, fileId);
  }

  /**
   * 读一关。示例玩法按参数现场生成；换成读关卡文件的玩法时在这里 loadJson('config/levels/level_XXXX')。
   * ease：连输后降的档；开发版难度调试页挑了档（devtools/levelLab.ts）就用挑的那一档
   */
  async loadLevel(fileId: number, ease: number, trayDelta = 0): Promise<DemoLevel> {
    const custom = lab.override(fileId);
    const e = custom && typeof custom.ease === 'number' ? custom.ease : ease;
    return generate(this.levels, fileId, e, trayDelta, this.seeds[String(fileId)] ?? 0);
  }
}
