// 商店（主页入口进来的子页面；docs/01）：金币买技能、金币买生命、看广告领金币。
// 页头和别的子页面一样：返回键、标题牌，右边一条金币数（这一页花的是金币；生命数写在生命那张卡上）。
// 技能卡两列排；技能是单数时（示例玩法是 3 个：撤销、提示、洗牌）生命做成同样大的卡补在最后一格，
// 「免费金币」（有广告时）在最下面占满一行；技能是双数时生命和免费金币在最下面并排两张小卡。
// 卡片同一种排法：左上名字、右上小字状态、中间图标、下面按钮。没解锁的技能换灰色锁定条和「第 N 关」。
// 金币不够：按钮照常可点，点了弹「金币不足」（spend）。
import { Node, Sprite, UITransform } from 'cc';
import * as Lives from '../core/meta/lives';
import * as Meta from '../core/meta/meta';
import * as Skills from '../core/meta/skills';
import { App } from '../services/app';
import { sfx } from '../services/audio';
import { now, today } from '../services/clock';
import * as fx from '../ui/fx';
import { tr } from '../ui/i18n';
import { Btn, COLOR, Capsule, at, hex, button, fitPair, fmt, fmtCoins, img, lazyImg, opacity, plate, slice, text } from '../ui/kit';
import { coinsFly, skillName, spend, watchAd } from '../ui/popups';
import { Screen } from '../ui/screen';
import { PAGE_BOTTOM, Page, enterStagger, headBottom, pageHead, ui } from '../ui/shell';

interface SkillCard {
  id: string;
  node: Node;
  name: ReturnType<typeof text>;
  /** 卡片里一行字能用的宽 */
  room: number;
  icon: Node;
  owned: ReturnType<typeof text>;
  buy: Btn;
  lock: Node;
}

/** 插画的视觉大小不一样（洗牌的箭头偏小），按图微调到看起来一样大 */
const ICON_K: Record<string, number> = { undo: 0.96, hint: 1, shuffle: 1.1, blow: 1.06, net: 1 };

/** 蓝色面板上的次要文字（已有数量、今日次数）：比白色淡一档 */
const SOFT = hex('#D4ECFF');

export class ShopPage extends Page {
  private cards: SkillCard[] = [];
  private lifeBtn!: Btn;
  private lifeTitle!: ReturnType<typeof text>;
  private adTitle!: ReturnType<typeof text>;
  private smallRoom = 0;
  /** 免费金币那张卡一行字能用的宽（技能是单数时它占满一行，比生命卡宽） */
  private adRoom = 0;
  private lifeCount!: ReturnType<typeof text>;
  private heart!: Node;
  /** 免费金币卡：这一版没有广告时不建 */
  private adBtn: Btn | null = null;
  private adPanel: Node | null = null;
  private adLeft!: ReturnType<typeof text>;
  private rows: Node[] = [];
  private coins!: Capsule;

  build(root: Node): void {
    const eco = App.config.eco;
    const bgH = Math.max(Screen.H, Screen.W * 1.5);
    lazyImg(root, 'bg/home', (bgH * 1024) / 1536, bgH);
    this.coins = pageHead(root, tr('UI_TAB_SHOP'), { coins: true }) as Capsule;

    // 两列卡片 + 最下面一行小卡；页边距 20，卡片间距 16。
    // 技能是单数：生命做成同样大的卡补在技能卡的最后一格，最下面一行只有「免费金币」（没有广告时这一行不要）；
    // 技能是双数：最下面一行生命、免费金币并排（没有广告时生命占满一行）。
    // 技能加到 6 个以后第三排卡被最下面那一行压住了、撤销和提示没有名字
    const M = 20;
    const G = 16;
    const cardW = (Screen.W - M * 2 - G) / 2;
    const y1 = Screen.bottom + PAGE_BOTTOM;
    const rowH = 168;
    const ids = Skills.ids(eco);
    const ads = App.platform.hasCapability('ads');
    const lifeInGrid = ids.length % 2 === 1;
    const slots = ids.length + (lifeInGrid ? 1 : 0);
    const rows = Math.ceil(slots / 2);
    const bottomRow = !lifeInGrid || ads;
    // 页头下面（微信小游戏里金币条在胶囊那一行下面，再往下让出那一行）
    const top = headBottom(true) - 14;
    const room = top - y1;
    const below = bottomRow ? rowH + G : 0;
    const cardH = Math.min(430, (room - below - G * rows) / rows);
    const used = cardH * rows + G * (rows - 1) + below;
    // 屏幕高、放不满时整块略往下放，不贴着页头；微信小游戏里页头下面已经有一行金币条，不再往下推（间距太大）
    const y0 = Screen.cap ? top : top - Math.max(0, room - used) / 3;
    const cx = cardW / 2 + G / 2;
    const slotAt = (i: number): [number, number] => [(i % 2 === 0 ? -1 : 1) * cx, y0 - cardH / 2 - Math.floor(i / 2) * (cardH + G)];
    ids.forEach((id, i) => {
      const [x, y] = slotAt(i);
      this.cards.push(this.skillCard(root, id, x, y, cardW, cardH));
    });
    if (lifeInGrid) {
      const [x, y] = slotAt(ids.length);
      this.rows.push(this.lifeCard(root, x, y, cardW, cardH));
    }
    const rowY = y0 - rows * (cardH + G) - rowH / 2;
    if (lifeInGrid) {
      if (ads) this.rows.push(this.adRow(root, 0, rowY, Screen.W - M * 2, rowH));
    } else if (ads) {
      this.rows.push(this.lifeRow(root, -cx, rowY, cardW, rowH));
      this.rows.push(this.adRow(root, cx, rowY, cardW, rowH));
    } else {
      this.rows.push(this.lifeRow(root, 0, rowY, Screen.W - M * 2, rowH));
    }
  }

  /** 生命做成和技能卡一样大的卡（技能是单数时补在最后一格）：名字 · 右上当前数量 · 大红心 · 金币买一条 */
  private lifeCard(root: Node, x: number, y: number, w: number, h: number): Node {
    const n = slice(root, 'kit/panel_blue', w, h, 'lives');
    at(n, x, y);
    this.lifeTitle = text(n, tr('H_LIVES_TITLE'), 38, { align: 'left' });
    at(this.lifeTitle.node, -w / 2 + 26, h / 2 - 44);
    this.lifeCount = text(n, '', 26, { color: SOFT, align: 'right' });
    at(this.lifeCount.node, w / 2 - 24, h / 2 - 44);
    this.smallRoom = w - 50;
    const btnH = 92;
    const btnY = -h / 2 + 24 + btnH / 2;
    const lo = btnY + btnH / 2 + 10;
    const room = h / 2 - 76 - lo;
    const is = Math.max(100, Math.min(190, room));
    const cy = lo + room / 2;
    const glow = img(n, 'kit/fx_glow', is * 1.5, is * 1.5, 'glow');
    at(glow, 0, cy);
    opacity(glow).opacity = 110;
    this.heart = img(n, 'icon/heart', is, is, 'heart');
    at(this.heart, 0, cy);
    this.lifeBtn = button(n, {
      color: 'green',
      w: w - 44,
      h: btnH,
      icon: 'icon/coin',
      iconSize: 56,
      label: fmt(App.config.eco.lives.buyOneCoins),
      fontSize: 44,
      onTap: () => this.buyLife(),
    });
    at(this.lifeBtn.node, 0, btnY);
    return n;
  }

  /** 技能卡：名字 · 大插画 · 已有数量 · 金币价格按钮（主按钮色）；没开放的换灰色锁定条 */
  private skillCard(root: Node, id: string, x: number, y: number, w: number, h: number): SkillCard {
    const eco = App.config.eco;
    const n = slice(root, 'kit/panel_blue', w, h, `skill_${id}`);
    at(n, x, y);
    // 和下面两张小卡同一种排法：左上名字、右上小字状态（已有数量）
    const name = text(n, skillName(id), 38, { align: 'left' });
    at(name.node, -w / 2 + 26, h / 2 - 44);
    const owned = text(n, '', 26, { color: SOFT, align: 'right' });
    at(owned.node, w / 2 - 24, h / 2 - 44);
    const btnH = 92;
    const btnW = w - 44;
    const btnY = -h / 2 + 24 + btnH / 2;
    // 插画占满名字和按钮之间，后面垫一团柔光把它从面板上托起来
    const lo = btnY + btnH / 2 + 10;
    const room = h / 2 - 76 - lo;
    const is = Math.max(110, Math.min(210, room)) * (ICON_K[id] ?? 1);
    const cy = lo + room / 2;
    const glow = img(n, 'kit/fx_glow', is * 1.5, is * 1.5, 'glow');
    at(glow, 0, cy);
    opacity(glow).opacity = 110;
    const icon = img(n, `icon/skill_${id}`, is, is, 'icon');
    at(icon, 0, cy);

    const buy = button(n, {
      color: 'green',
      w: btnW,
      h: btnH,
      icon: 'icon/coin',
      iconSize: 56,
      label: fmt(Skills.price(eco, id)),
      fontSize: 44,
      onTap: () => this.buySkill(id),
    });
    at(buy.node, 0, btnY);
    const lock = plate(n, 'skin/j_btn_gray', btnW, btnH, 'lock');
    at(lock, 0, btnY);
    const li = img(lock, 'kit/ic_lock', 44, 44, 'ic');
    const ll = text(lock, tr('SKILL_LOCKED', Skills.unlockLevel(eco, id)), 30);
    ll.updateRenderData(true);
    const lw = (ll.node.getComponent(UITransform) as UITransform).width;
    at(li, -(lw + 52) / 2 + 22, 4);
    at(ll.node, 26, 3);
    return { id, node: n, name, room: w - 50, icon, owned, buy, lock };
  }

  /** 生命：标题、心 + 当前数量、金币买一条 */
  private lifeRow(root: Node, x: number, y: number, w: number, h: number): Node {
    const n = slice(root, 'kit/panel_blue', w, h, 'lives');
    at(n, x, y);
    this.lifeTitle = text(n, tr('H_LIVES_TITLE'), 36, { align: 'left' });
    at(this.lifeTitle.node, -w / 2 + 26, h / 2 - 42);
    this.smallRoom = w - 50;
    // 和右边的小卡同一种排法：左上标题、右上小字状态、左下图标、右下按钮
    this.lifeCount = text(n, '', 26, { color: SOFT, align: 'right' });
    at(this.lifeCount.node, w / 2 - 24, h / 2 - 42);
    this.heart = img(n, 'icon/heart', 88, 88, 'heart');
    at(this.heart, -w / 2 + 26 + 44, -30);
    this.lifeBtn = button(n, {
      color: 'green',
      w: 176,
      h: 78,
      icon: 'icon/coin',
      iconSize: 46,
      label: fmt(App.config.eco.lives.buyOneCoins),
      fontSize: 36,
      onTap: () => this.buyLife(),
    });
    at(this.lifeBtn.node, w / 2 - 24 - 88, -32);
    return n;
  }

  /** 免费金币：看广告（琥珀色按钮）+ 今日剩余次数 */
  private adRow(root: Node, x: number, y: number, w: number, h: number): Node {
    const eco = App.config.eco;
    const n = slice(root, 'kit/panel_blue', w, h, 'freeCoins');
    at(n, x, y);
    this.adTitle = text(n, tr('SHOP_FREE_COINS'), 36, { align: 'left' });
    this.adRoom = w - 50;
    at(this.adTitle.node, -w / 2 + 26, h / 2 - 42);
    this.adLeft = text(n, '', 26, { color: SOFT, align: 'right' });
    at(this.adLeft.node, w / 2 - 24, h / 2 - 42);
    const pile = box3(n);
    at(pile, -w / 2 + 26 + 44, -28);
    pile.setScale(0.84, 0.84, 1);
    this.adBtn = button(n, {
      color: 'yellow',
      w: 176,
      h: 78,
      icon: 'kit/ic_video',
      iconSize: 42,
      label: `+${eco.freeCoin.amount}`,
      fontSize: 36,
      onTap: () => void this.freeCoins(),
    });
    at(this.adBtn.node, w / 2 - 24 - 88, -32);
    this.adPanel = n;
    return n;
  }

  override show(): void {
    this.refresh();
    enterStagger([...this.cards.map((c) => c.node), ...this.rows], 0.05);
  }

  override refresh(): void {
    const s = App.save.data;
    const eco = App.config.eco;
    const t = now();
    this.coins.set(fmtCoins(s.coins));
    for (const c of this.cards) {
      const open = Skills.isUnlocked(eco, c.id, s.level);
      (c.icon.getComponent(Sprite) as Sprite).grayscale = !open;
      c.buy.node.active = open;
      c.lock.active = !open;
      c.owned.string = open ? tr('UI_OWNED', Skills.count(s, c.id)) : '';
      fitPair(c.name, c.owned, c.room, 38, 26);
    }
    Lives.refresh(s, eco, t);
    const unlimited = Lives.isUnlimited(s, t);
    const full = unlimited || Lives.count(s, eco, t) >= eco.lives.max;
    this.lifeCount.string = unlimited ? '∞' : `${Lives.count(s, eco, t)}/${eco.lives.max}`;
    fitPair(this.lifeTitle, this.lifeCount, this.smallRoom, 36, 26);
    this.lifeBtn.setEnabled(!full);
    if (this.lifeBtn.icon) this.lifeBtn.icon.active = !full;
    this.lifeBtn.setLabel(full ? tr('UI_FULL') : fmt(eco.lives.buyOneCoins));
    if (!this.adBtn) return;
    const left = Meta.freeCoinLeft(s, eco, today());
    this.adLeft.string = tr('SHOP_AD_LEFT', left, eco.freeCoin.daily);
    fitPair(this.adTitle, this.adLeft, this.adRoom, 36, 26);
    this.adBtn.setEnabled(left > 0);
    // 拉不到广告时整块不出现；今天次数用完时还在，按钮变灰、写着剩 0 次
    if (this.adPanel) this.adPanel.active = App.platform.adsAvailable();
  }

  private buySkill(id: string): void {
    const s = App.save.data;
    const eco = App.config.eco;
    const price = Skills.price(eco, id);
    // 金币不够：看广告直接领 1 个（docs/01 7.1）
    const grant = () => {
      Skills.add(App.save.data, id);
      App.save.write();
      ui.refresh();
    };
    if (!spend(price, { icon: `icon/skill_${id}`, placement: 'rv_tool', grant })) return;
    if (!Skills.buy(s, eco, id)) return;
    App.save.write();
    sfx('coin');
    const c = this.cards.find((k) => k.id === id);
    if (c) {
      fx.squash(c.icon);
      const plus = text(null, '+1', 48, { color: COLOR.yellow });
      fx.floatUp(c.node, plus.node, 0, 40);
    }
    ui.refresh();
  }

  private buyLife(): void {
    const s = App.save.data;
    const eco = App.config.eco;
    if (!spend(eco.lives.buyOneCoins)) return;
    if (!Lives.buyOne(s, eco, now())) {
      ui.toast(tr('H_LIVES_FULL'));
      return;
    }
    App.save.write();
    sfx('coin');
    fx.squash(this.heart);
    ui.refresh();
  }

  private async freeCoins(): Promise<void> {
    const s = App.save.data;
    const eco = App.config.eco;
    if (Meta.freeCoinLeft(s, eco, today()) <= 0) {
      ui.toast(tr('SHOP_AD_DONE'));
      return;
    }
    if (!this.adBtn || !(await watchAd('rv_free_coin'))) return;
    if (!Meta.takeFreeCoin(s, eco, today())) return;
    App.save.write();
    const tf = ui.fx.getComponent(UITransform) as UITransform;
    const from = tf.convertToNodeSpaceAR(this.adBtn.node.worldPosition.clone());
    const to = tf.convertToNodeSpaceAR((this.coins.icon as Node).worldPosition.clone());
    coinsFly([from.x, from.y], this.coins.label, [to.x, to.y]);
    sfx('coins');
    ui.refresh();
  }
}

/** 一小堆金币（三枚叠放） */
function box3(parent: Node): Node {
  const n = img(parent, 'icon/coin', 70, 70, 'pile');
  const a = img(n, 'icon/coin', 56, 56, 'a');
  at(a, -26, -16);
  const b = img(n, 'icon/coin', 56, 56, 'b');
  at(b, 26, -18);
  a.setSiblingIndex(0);
  b.setSiblingIndex(0);
  return n;
}
