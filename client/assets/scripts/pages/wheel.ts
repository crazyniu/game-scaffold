// 宝箱抽奖页（docs/01、docs/09）。主页子页面，左上返回。
// 一只大宝箱 + 剩余次数 + 主按钮（有次数「开箱」，没次数「200 金币开箱」），下面一排：十连、看广告 +1、分享 +1。
// 不展示概率。宝箱周围飘着几个装着奖品的光球（金币、技能、收藏卡、无限生命：告诉玩家能开出什么）。
// 开箱（约 1.6 秒）：光球被吸进宝箱 → 宝箱跟着一串越来越快的音一下一下鼓、越晃越大、光越来越亮 → 弹开：闪白、放射光、
// 冲击波、彩纸、屏幕震 → 奖品从箱子里升起来亮相 → 收藏卡先翻面 → 开奖弹窗。十连：十个奖品喷出来排成两排。
import { Color, Node, Sprite, Tween, Vec3, tween } from 'cc';
import * as Cards from '../core/meta/cards';
import type { CardResult } from '../core/meta/save';
import * as Wheel from '../core/meta/wheel';
import { Rng } from '../core/rng/rng';
import { App } from '../services/app';
import { buzz, sfx } from '../services/audio';
import { now, today } from '../services/clock';
import * as fx from '../ui/fx';
import { tr } from '../ui/i18n';
import { at, box, button, COLOR, fmt, img, lazyImg, opacity, setImg, slice, text, twoLines } from '../ui/kit';
import { PrizeItem, cardItem, needCoins, offerAd, revealCards, rewardPopup, skillIcon, skillName, watchAd } from '../ui/popups';
import { Screen } from '../ui/screen';
import { Page, headBottom, pageHead, ui } from '../ui/shell';

/** 一次抽奖结果 → 奖品格 */
export function spinItem(r: Wheel.SpinResult): PrizeItem {
  if (r.card) return cardItem(r.card);
  if (r.kind === 'coins') return { icon: 'icon/coin', amount: fmt(r.coins), name: tr('PRIZE_COINS') };
  if (r.kind === 'skill') return { icon: skillIcon(r.skill || 'shuffle'), amount: '×1', name: skillName(r.skill || 'shuffle') };
  if (r.kind === 'unlimited') return { icon: 'icon/heart_inf', amount: tr('UI_MINUTES', Math.round(r.unlimited / 60)) };
  return { icon: 'icon/gift', amount: '' };
}

const CHEST = 'icon/chest_wheel';
const CHEST_OPEN = 'icon/chest_wheel_open';
const WARM = new Color(255, 232, 140, 255);
/** 宝箱周围的奖品光球：[图标, 角度（度，0 = 右，90 = 上）, 光球直径, 图标宽, 图标高] */
const SHOWCASE: [string, number, number, number, number][] = [
  ['icon/coin', 152, 128, 78, 78],
  ['icon/card_back', 90, 136, 62, 83],
  ['icon/heart_inf', 28, 128, 80, 80],
  ['icon/skill_shuffle', 205, 108, 74, 74],
  ['icon/skill_undo', -25, 108, 74, 74],
];
/** 蓄力的 9 拍（秒），和 wheel_charge 音效里的 9 个音对齐（client/tools/audio/kenney.py） */
const BEATS = [0, 0.19, 0.35, 0.49, 0.61, 0.71, 0.8, 0.88, 0.95];

export class WheelPage extends Page {
  private root!: Node;
  private view: Node | null = null;
  private chest!: Node;
  private chestS = 420;
  private mid = 0;
  private rays!: Node;
  private glow!: Node;
  private orbs: Node[] = [];
  private busy = false;

  build(root: Node): void {
    this.root = root;
    const bgH = Math.max(Screen.H, Screen.W * 1.5);
    lazyImg(root, 'bg/chapter_4', (bgH * 1024) / 1536, bgH);
  }

  override show(): void {
    this.busy = false;
    this.render(true);
  }

  override refresh(): void {
    if (!this.busy) this.render(false);
  }

  private render(enter: boolean): void {
    const s = App.save.data;
    const eco = App.config.eco;
    const day = today();
    const left = Wheel.spinsLeft(s, eco, day);
    this.view?.destroy();
    const v = box('view', this.root, Screen.W, Screen.H);
    this.view = v;
    // 标题行：左返回 · 中标题 · 右金币（微信小游戏里金币在下一行右上角，内容从 headBottom 往下）
    pageHead(v, tr('H_FEAT_WHEEL'), { coins: true });

    // 自下而上：次按钮一排 → 主按钮；上面剩下的空间里，宝箱（连同一圈奖品光球）和紧贴在箱子下面的「剩几次」作为一组居中
    // （原来「剩几次」贴着主按钮，和宝箱之间空一大段，像浮着的一根条）
    const y2 = Screen.bottom + 40 + 54;
    const btnY = y2 + 54 + 24 + 64;
    const lo = btnY + 64 + 24;
    const hi = headBottom(true) - 4;
    // 一组的高：光球最高处在箱子中心上方 0.64cs + 68，箱底在中心下方约 0.45cs，再往下是 20 的空和 72 高的牌子
    const cs = Math.min(420, (hi - lo - 160) / 1.09);
    const mid = hi - 0.64 * cs - 68 - (hi - lo - (1.09 * cs + 160)) / 2;
    const cntY = mid - 0.45 * cs - 56;
    this.chestS = cs;
    this.mid = mid;
    // 宝箱背后：暖色放射光慢慢转 + 一团呼吸的柔光
    this.rays = fx.rays(v, cs * 2.1);
    (this.rays.getComponent(Sprite) as Sprite).color = WARM;
    opacity(this.rays).opacity = 150;
    at(this.rays, 0, mid);
    this.glow = img(v, 'kit/fx_glow', cs * 1.7, cs * 1.7, 'glow');
    (this.glow.getComponent(Sprite) as Sprite).color = WARM;
    opacity(this.glow).opacity = 200;
    at(this.glow, 0, mid);
    fx.breathe(this.glow, 0.08, 2.2);
    // 奖品光球：绕着宝箱一圈，各自上下浮
    this.orbs = SHOWCASE.map(([icon, deg, d, iw, ih], i) => {
      const a = (deg * Math.PI) / 180;
      const b = img(v, 'skin/j_orb', d, d, 'prizeOrb');
      at(b, Math.cos(a) * Math.min(cs * 0.74, Screen.W / 2 - d / 2 - 14), mid + Math.sin(a) * cs * 0.64);
      img(b, icon, iw, ih, 'icon');
      if (enter) fx.popIn(b, 0.12 + i * 0.07, 0.3);
      fx.bob(b, 9, 2.2 + i * 0.25, i * 0.3);
      return b;
    });
    // 宝箱图是箱底对齐的（开盖后盖子往上长），节点往上挪一点，箱体才在光的正中
    this.chest = img(v, CHEST, cs, cs, 'chest');
    at(this.chest, 0, mid + cs * 0.09);
    fx.bob(this.chest, 6, 2.6);
    if (left > 0) fx.wiggle(this.chest, 5, 2.2);
    // 星光：宝箱周围隔一会闪一颗
    const twinkle = () => {
      if (!v.isValid || !v.activeInHierarchy) return;
      if (!this.busy) {
        const a = Math.random() * Math.PI * 2;
        fx.sparkle(v, Math.cos(a) * cs * 0.55, mid + Math.sin(a) * cs * 0.45, 3, 46, WARM, 30);
      }
      fx.delay(v, 0.45 + Math.random() * 0.4, twinkle);
    };
    fx.delay(v, 0.6, twinkle);

    // 剩余次数
    const cnt = slice(v, 'kit/title_plate', 320, 72, 'left');
    at(cnt, 0, cntY);
    at(text(cnt, tr('H_SPINS_LEFT', left), 32).node, 0, 0);

    // 主按钮：有次数「开箱」，没次数「金币 1000 开箱」
    const main =
      left > 0
        ? button(v, { color: 'green', w: 520, h: 128, label: tr('H_SPIN'), fontSize: 56, onTap: () => this.open('spin') })
        : button(v, { color: 'green', w: 520, h: 128, icon: 'icon/coin', iconSize: 64, label: `${fmt(eco.wheel.coinCost)} ${tr('H_SPIN')}`, fontSize: 48, onTap: () => this.open('coins') });
    at(main.node, 0, btnY);
    fx.breathe(main.node, 0.03, 1.3);

    // 下一排（次按钮，两行字都在按钮里）：十连（金币价）· 看广告 +1（今日剩余）· 分享 +1（今日剩余）；
    // 平台没有广告、没有确认分享的就少一个，剩下的居中排
    const BW = 218;
    const row: Node[] = [];
    const ten = button(v, { color: 'blue', w: BW, h: 108, onTap: () => this.ten() });
    twoLines(ten, tr('H_TEN_PULL'), `${fmt(eco.wheel.tenCost)}`, 'icon/coin');
    row.push(ten.node);
    // 看广告 +1：拉不到广告时不出现，剩下的居中排
    if (offerAd('rv_wheel')) {
      const adLeft = Wheel.adLeft(s, eco, day);
      const ad = button(v, {
        color: 'yellow',
        w: BW,
        h: 108,
        onTap: async () => {
          if (Wheel.adLeft(App.save.data, eco, today()) <= 0) return;
          if (!(await watchAd('rv_wheel'))) return;
          Wheel.claimAd(App.save.data, eco, today());
          App.save.write();
          sfx('coin');
          ui.refresh();
        },
      });
      twoLines(ad, '+1', tr('ADS_LEFT', adLeft), null, 'kit/ic_video');
      row.push(ad.node);
      ad.setEnabled(adLeft > 0);
    }
    row.forEach((n, i) => at(n, (i - (row.length - 1) / 2) * (BW + 16), y2));
    if (enter) fx.popIn(this.chest, 0, 0.3);
  }

  /** 开一个：先晃宝箱，再出结果 */
  private open(pay: 'spin' | 'coins'): void {
    if (this.busy) return;
    const s = App.save.data;
    const eco = App.config.eco;
    if (pay === 'coins' && s.coins < eco.wheel.coinCost) {
      needCoins(eco.wheel.coinCost - s.coins, () => ui.refresh());
      return;
    }
    const r = Wheel.spin(s, eco, App.config.cards, new Rng(Date.now() >>> 0), today(), now(), pay);
    if (!r) return;
    App.save.write();
    this.busy = true;
    this.shakeOpen([spinItem(r)], () => {
      const show = () =>
        rewardPopup([spinItem(r)], {
          onClose: () => {
            this.busy = false;
            ui.refresh();
          },
        });
      if (r.card) revealCards([r.card], show);
      else show();
    });
  }

  private ten(): void {
    if (this.busy) return;
    const s = App.save.data;
    const eco = App.config.eco;
    if (s.coins < eco.wheel.tenCost) {
      needCoins(eco.wheel.tenCost - s.coins, () => ui.refresh());
      return;
    }
    const res = Wheel.tenPull(s, eco, App.config.cards, new Rng(Date.now() >>> 0), today(), now());
    if (!res) return;
    App.save.write();
    this.busy = true;
    const items = res.results.map(spinItem);
    this.shakeOpen(items, () => {
      rewardPopup(items, {
        title: tr('TEN_REWARD'),
        onClose: () => {
          // 稀有以上的卡全屏再翻一次
          const good: CardResult[] = res.results
            .map((r) => r.card)
            .filter((c): c is CardResult => !!c && Cards.rank(eco, c.rarity) >= Cards.rank(eco, 'rare'));
          revealCards(good, () => {
            this.busy = false;
            ui.refresh();
          });
        },
      });
    });
  }

  /** 开箱演出：吸光球 → 蓄力（9 拍，越来越快）→ 弹开 → 奖品升起亮相 → done（接翻卡、开奖弹窗） */
  private shakeOpen(items: PrizeItem[], done: () => void): void {
    const c = this.chest;
    const v = this.view as Node;
    const cs = this.chestS;
    const mid = this.mid;
    Tween.stopAllByTarget(c);
    c.angle = 0;
    at(c, 0, mid + cs * 0.09);
    sfx('charge');
    // 光球依次被吸进宝箱
    this.orbs.forEach((b, i) => {
      Tween.stopAllByTarget(b);
      fx.delay(v, i * 0.05, () => {
        if (!b.isValid) return;
        fx.flyArc(b, 0, mid, 0.3, 60, 'quadIn', () => b.destroy(), 0.15);
      });
    });
    // 蓄力：每一拍宝箱鼓一下、歪向另一边，一拍比一拍大；背后的光越来越亮，放射光越转越快
    Tween.stopAllByTarget(this.rays);
    tween(this.rays).by(1.05, { angle: -520 }, { easing: 'quadIn' }).start();
    tween(opacity(this.rays)).to(1.0, { opacity: 255 }).start();
    Tween.stopAllByTarget(this.glow);
    tween(this.glow).to(1.0, { scale: new Vec3(1.35, 1.35, 1) }, { easing: 'quadIn' }).start();
    BEATS.forEach((t, k) => {
      fx.delay(v, t, () => {
        if (!c.isValid) return;
        const s1 = 1 + 0.03 * (k + 1);
        const rest = 1 + 0.012 * (k + 1);
        Tween.stopAllByTarget(c);
        c.setScale(s1 + 0.06, s1 - 0.05, 1);
        c.angle = (k % 2 === 0 ? 1 : -1) * (3 + k * 1.3);
        tween(c).to(0.07, { scale: new Vec3(rest, rest, 1) }, { easing: 'quadOut' }).start();
        fx.ring(v, 0, mid, cs * 0.5, cs * (0.9 + k * 0.06), WARM, 0.3);
        buzz(k >= 6 ? 'medium' : 'light');
      });
    });
    // 弹开
    fx.delay(v, 1.05, () => {
      if (!c.isValid) return;
      const half = Screen.W / 2;
      Tween.stopAllByTarget(c);
      c.angle = 0;
      setImg(c, CHEST_OPEN, cs, cs);
      c.setScale(1.45, 1.2, 1);
      tween(c).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
      fx.flash(this.root, Screen.W, Screen.H, 190);
      fx.rayBurst(v, 0, mid, Math.hypot(Screen.W, Screen.H) * 1.2, WARM, 0.7, 220);
      fx.ring(v, 0, mid, 160, Screen.H * 1.1, WARM, 0.55);
      fx.ring(v, 0, mid, 120, 700, COLOR.white, 0.4);
      fx.sparkle(v, 0, mid + cs * 0.1, 24, cs * 0.8, COLOR.yellow, 50);
      fx.cannon(v, -half - 10, mid - cs * 0.6, 62, 36, 1000);
      fx.cannon(v, half + 10, mid - cs * 0.6, 118, 36, 1000);
      fx.trauma(v, 0.6, 18);
      sfx('chest');
      buzz('heavy');
      Tween.stopAllByTarget(this.rays);
      tween(this.rays).repeatForever(tween(this.rays).by(6, { angle: -360 })).start();
      this.emerge(items, v, mid, cs);
    });
    fx.delay(v, 1.05 + (items.length > 1 ? 1.25 : 0.85), done);
  }

  /** 奖品从箱口升起来：一个就放大停在宝箱上方；十连就喷出来排成两排 */
  private emerge(items: PrizeItem[], v: Node, mid: number, cs: number): void {
    const many = items.length > 1;
    const cols = 5;
    items.forEach((it, i) => {
      const s0 = many ? 104 : 200;
      const n = box('prize', v, s0, s0);
      // 收藏卡先亮卡背（正面留给翻卡）
      img(n, it.rarity ? 'icon/card_back' : it.icon, it.rarity ? s0 * 0.75 : s0, s0, 'icon');
      at(n, 0, mid + cs * 0.14);
      n.setScale(0.15, 0.15, 1);
      const tx = many ? ((i % cols) - (cols - 1) / 2) * 128 : 0;
      const ty = many ? mid + cs * 0.62 + (1 - Math.floor(i / cols)) * 124 : mid + cs * 0.62;
      fx.delay(v, many ? i * 0.06 : 0.05, () => {
        if (!n.isValid) return;
        if (many) sfx('coin', 0, 0.7);
        fx.flyArc(n, tx, ty, many ? 0.34 : 0.3, many ? 90 : 30, 'quadOut', () => {
          if (!n.isValid) return;
          fx.glowPop(v, tx, ty, s0 * 2.2, WARM, 0.4, 230);
          fx.sparkle(v, tx, ty, many ? 5 : 12, s0 * 0.9, COLOR.yellow, many ? 26 : 40);
          n.setScale(1.25, 1.25, 1);
          tween(n).to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }, 1.05);
      });
    });
  }
}
