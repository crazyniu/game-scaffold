// 过关结算页。横幅砸下 → 三颗星依次点亮 → 金币数字滚动 → 宝箱晃动、弹开亮出奖品 → 按钮出现、
// 「下一关」呼吸；点任意处跳到最终状态；全程 ≤ 3 秒（docs/09）。
// 三颗星按成绩亮（docs/01）：一个道具都没用三颗；没拿到的星位留着、是灰的。第一次三星在奖励条里多一格。
import { Node, Sprite, Tween, UITransform, Vec3, tween } from 'cc';
import * as Meta from '../core/meta/meta';
import * as Settle from '../core/meta/settle';
import { App } from '../services/app';
import { buzz, sfx } from '../services/audio';
import * as fx from '../ui/fx';
import { tr } from '../ui/i18n';
import { at, box, Btn, button, COLOR, fit, img, lazyImg, onTap, opacity, plate, setImg, slice, text, textWidth } from '../ui/kit';
import { cardItem, prizeCell, watchAd } from '../ui/popups';
import { Screen } from '../ui/screen';
import { Page } from '../ui/shell';
import * as Flow from './flow';
import { kindTag, levelKind } from './levelKind';

/** 底部 Banner 广告的高度（设计单位） */
const BANNER_H = 120;

export class ResultPage extends Page {
  private d!: Flow.WinData;
  private content!: Node;
  private skipTo: (() => void) | null = null;

  /** 演出播完：连击送的卡、宝箱开出的卡依次翻面；机器人代打时翻完自己进下一关 */
  private reveal(): void {
    const d = this.d;
    Flow.revealPending(d.cards.splice(0), () => Flow.autoNext(d));
  }

  build(root: Node): void {
    lazyImg(root, 'bg/home', Screen.W * 1.02, Math.max(Screen.H, Screen.W * 1.5));
    this.content = box('content', root, Screen.W, Screen.H);
    onTap(root, () => this.skipTo?.(), { press: 0, sound: null });
  }

  override back(): boolean {
    void Flow.afterResult(this.d, false);
    return false;
  }

  override hide(): void {
    App.platform.hideBanner();
  }

  override show(arg?: unknown): void {
    this.d = arg as Flow.WinData;
    if (Meta.shouldShowBanner(App.config.ads, this.d.level)) App.platform.showBanner('bn_result');
    this.content.destroyAllChildren();
    const d = this.d;
    const r = d.result;
    const c = this.content;
    const cfg = App.config.ui.win;
    const at0 = (k: string) => Number(cfg[k] ?? 0);
    const top = Screen.top;
    // 从下往上排：底部给 Banner 留位（docs/01），最下面一行「主页」「分享」「翻倍」并排 → 下一关 → 奖励条 → 宝箱；
    // 横幅和星星贴顶（翻倍和主页放一行）
    const hasDouble = r.rewarded && r.coins > 0 && App.platform.adsAvailable();
    const homeY = Screen.bottom + BANNER_H + 64;
    const nextY = homeY + 140;
    const rowY = nextY + 175;
    const ribbonY = top - 270;
    // 横幅下面一行小字说星级（三星「完美」，没到三星告诉怎么拿），宝箱让出这一行
    const noteY = ribbonY - 122;
    const chestY = (noteY - 22 + rowY + 85) / 2;
    const chestS = Math.min(260, noteY - 22 - (rowY + 85) - 10);
    // 宝箱图是箱底对齐的（开盖后盖子往上长），节点往上挪一点，箱体才在正中
    const chestC = chestY + chestS * 0.09;

    // 横幅与星星
    const ribbon = plate(c, 'skin/f_ribbon', 700, 200, 'ribbon');
    at(ribbon, 0, ribbonY);
    const title = text(ribbon, tr('WIN_TITLE'), 80);
    at(title.node, 0, 14);
    fit(title, 470, 80, 44);
    const got = d.stars ? d.stars.stars : 3;
    const note = text(c, tr(got >= 3 ? 'RESULT_PERFECT' : 'RESULT_TRY_3STAR'), 30, { color: got >= 3 ? COLOR.yellow : COLOR.white, outline: COLOR.navy, outlineWidth: 4 });
    at(note.node, 0, noteY);
    fit(note, 640, 30, 20);
    const stars: Node[] = [];
    const starPos: [number, number][] = [0, 1, 2].map((i) => [(i - 1) * 170, top - 130 + (i === 1 ? 30 : 0)]);
    for (let i = 0; i < 3; i++) {
      const st = img(c, 'icon/star', i === 1 ? 150 : 120, i === 1 ? 150 : 120, 'star');
      at(st, starPos[i][0], starPos[i][1]);
      stars.push(st);
    }
    // 两张开心的角色（吉祥物，换成自己游戏的）+ 宝箱
    const left = img(c, 'card/c01', 210, 210, 'heroL');
    at(left, -240, chestY);
    const right = img(c, 'card/c02', 190, 190, 'heroR');
    at(right, 240, chestY + 20);
    right.setScale(-1, 1, 1);
    const rays = fx.rays(c, 420);
    at(rays, 0, chestY);
    opacity(rays).opacity = 0;
    const chestIcon = d.chest ? 'icon/chest' : 'icon/chest_open';
    const chest = img(c, chestIcon, chestS, chestS, 'chest');
    at(chest, 0, chestC);

    // 奖励一排：金币总数、技能、收藏卡、首胜（docs/01：图标 + 数字，不写明细）
    const pill = slice(c, 'kit/panel_glass', 660, 170, 'rewards');
    at(pill, 0, rowY);
    opacity(pill).opacity = 235;
    const items: Node[] = [];
    // 金币一格：图标 + 左对齐的数字。格宽按最后会跳到的数（翻倍后）量出来，数字跳动变长也不压到右边的格子，
    // 也不在右边空一大块（奖励一排一边挤一边空）
    const coinCell = box('coins', pill, 270, 150);
    const coinLabel = text(coinCell, `+${r.coins * 2}`, 50, { align: 'left' });
    const coinW = 96 + 14 + Math.max(60, textWidth(coinLabel)) + 16;
    coinLabel.string = '+0';
    (coinCell.getComponent(UITransform) as UITransform).setContentSize(coinW, 150);
    const coinIcon = img(coinCell, 'icon/coin', 96, 96, 'icon');
    at(coinIcon, -coinW / 2 + 48, 0);
    at(coinLabel.node, -coinW / 2 + 96 + 14, 0);
    // 难关、超难关：金币那一格左上角压同色小牌子（过关金币 60 / 90，docs/09）
    const kind = levelKind(d.level);
    if (kind !== 'normal' && r.rewarded) {
      const t = kindTag(coinCell, kind, 34);
      const tw = (t.getComponent(UITransform) as UITransform).width;
      at(t, -coinW / 2 + tw / 2 - 6, 70);
    }
    items.push(coinCell);
    const extras: Node[] = [];
    const chestPrize = d.chest;
    if (chestPrize && chestPrize.kind === 'skill' && chestPrize.skill) {
      extras.push(prizeCell(pill, { icon: `icon/skill_${chestPrize.skill}`, amount: '×1' }, 96));
    }
    if (chestPrize && chestPrize.kind === 'coins') {
      extras.push(prizeCell(pill, { icon: 'icon/gift', amount: `+${chestPrize.coins}` }, 96));
    }
    // 首次三星（docs/01）：奖章 + 金币一格，上面一行金色小字；送的技能各一格（送的卡和别的卡一起排在后面）
    const f3 = d.stars?.first3;
    if (f3) {
      const cell = prizeCell(pill, { icon: 'icon/first3', amount: `+${f3.coins}` }, 96);
      const cap = text(cell, tr('RESULT_FIRST_3STAR'), 20, { color: COLOR.yellow, outline: COLOR.navy, outlineWidth: 4 });
      at(cap.node, 0, 72);
      fit(cap, 124, 20, 14);
      extras.push(cell);
      for (const id of f3.skills) extras.push(prizeCell(pill, { icon: `icon/skill_${id}`, amount: '×1' }, 96));
    }
    for (const card of d.cards) extras.push(prizeCell(pill, cardItem(card), 96));
    if (r.first_win) extras.push(prizeCell(pill, { icon: 'icon/heart_inf', amount: tr('UI_MINUTES', Math.round(r.unlimited / 60)) }, 96));
    // 今天重玩的奖励领完了：金币那一格换成一句话；后面还有卡（连击送的）时，话放左边、卡排在右边，不叠在一起
    let first: Node = coinCell;
    let firstW = coinW + 20;
    if (!r.rewarded) {
      coinCell.active = false;
      const noReward = box('note', pill, 10, 150);
      const maxW = extras.length > 0 ? 620 - extras.length * 128 : 600;
      const l = text(noReward, tr('UI_REPLAY_NO_REWARD'), 34);
      fit(l, maxW, 34, 22);
      firstW = Math.min(maxW, textWidth(l)) + 24;
      first = noReward;
    }
    const all = [first, ...extras];
    const widths = all.map((_n, i) => (i === 0 ? firstW : 128));
    const total = widths.reduce((a, b) => a + b, 0);
    // 格子多了（首次三星 + 技能 + 几张卡）一排放不下：整排等比缩小到奖励条里
    const rowK = Math.min(1, 630 / total);
    let x = -total / 2;
    all.forEach((n, i) => {
      at(n, (x + widths[i] / 2) * rowK, 0);
      n.setScale(rowK, rowK, 1);
      x += widths[i];
    });
    for (const e of extras) e.active = false;

    // 按钮
    const s = App.save.data;
    const eco = App.config.eco;
    let dbl: Btn | null = null;
    // 最下面一行：主页（蓝）· 翻倍（黄，今天重玩奖励领完时没有），按个数等宽排开。
    // 不放分享键（游戏里不要分享按钮；只留微信右上角菜单的转发，docs/01）
    const bw = hasDouble ? 290 : 340;
    if (hasDouble) {
      dbl = button(c, {
        color: 'yellow',
        w: bw,
        h: 90,
        icon: 'kit/ic_video',
        label: tr('WIN_DOUBLE'),
        onTap: async () => {
          if (!dbl || !dbl.enabled) return;
          if (!(await watchAd('rv_double_coin'))) return;
          const extra = Settle.doubleCoins(s, eco, r);
          App.save.write();
          dbl.setEnabled(false);
          fx.countUp(coinLabel, r.coins, r.coins + extra, 0.5, (v) => `+${v}`);
          sfx('coins');
        },
      });
    }
    const next = button(c, { color: 'green', w: 540, h: 130, label: tr('UI_NEXT_LEVEL'), fontSize: 64, onTap: () => void Flow.afterResult(d, true) });
    at(next.node, 0, nextY);
    const home = button(c, { color: 'blue', w: bw, h: 90, label: tr('RETURN_HOME'), onTap: () => void Flow.afterResult(d, false) });
    const row = [home, dbl].filter((b): b is Btn => b !== null);
    row.forEach((b, i) => at(b.node, (i - (row.length - 1) / 2) * (bw + 16), homeY));
    const buttons = [dbl?.node, next.node, home.node].filter((n): n is Node => !!n);
    for (const b of buttons) b.active = false;
    const btnHome = buttons.map((b) => b.position.y);

    // ---- 演出时间表（docs/01）：横幅砸下 → 三颗星从宝箱飞上去依次落位 → 宝箱掉下、越晃越大、弹开 → 金币飞进奖励条、数字滚动 →
    // 按钮从下往上升起，「下一关」呼吸。全程约 2 秒，点任意处跳到最终状态
    const finalState = () => {
      this.skipTo = null;
      for (const n of [ribbon, ...stars, chest, pill, rays, left, right, ...buttons, ...extras]) {
        Tween.stopAllByTarget(n);
        Tween.stopAllByTarget(opacity(n));
      }
      ribbon.setScale(1, 1, 1);
      opacity(ribbon).opacity = 255;
      at(ribbon, 0, ribbonY);
      stars.forEach((st, i) => {
        st.setScale(1, 1, 1);
        st.angle = 0;
        at(st, starPos[i][0], starPos[i][1]);
        opacity(st).opacity = i < got ? 255 : 0;
      });
      at(chest, 0, chestC);
      chest.setScale(1, 1, 1);
      chest.angle = 0;
      // 淡入没播完就跳过的话宝箱会停在半透明
      opacity(chest).opacity = 255;
      if (d.chest) setImg(chest, 'icon/chest_open', chestS, chestS);
      opacity(rays).opacity = 255;
      rays.setScale(1, 1, 1);
      tween(rays).repeatForever(tween(rays).by(6, { angle: 360 })).start();
      pill.setScale(1, 1, 1);
      opacity(pill).opacity = 235;
      at(pill, 0, rowY);
      coinLabel.string = r.rewarded ? `+${r.coins}` : tr('UI_REPLAY_NO_REWARD');
      for (const e of extras) {
        e.active = true;
        e.setScale(rowK, rowK, 1);
      }
      buttons.forEach((b, i) => {
        b.active = true;
        b.setScale(1, 1, 1);
        at(b, b.position.x, btnHome[i]);
        opacity(b).opacity = 255;
      });
      at(left, -240, chestY);
      at(right, 240, chestY + 20);
      left.setScale(1, 1, 1);
      right.setScale(-1, 1, 1);
      fx.bob(left, 10, 1.8);
      fx.bob(right, 10, 2.1, 0.4);
      fx.breathe(next.node, 0.04, 1.2);
      this.reveal();
    };
    this.skipTo = finalState;
    const live = () => this.skipTo !== null;

    // 1. 横幅：从大到小砸下来，落地一震
    opacity(ribbon).opacity = 0;
    ribbon.setScale(1.9, 1.9, 1);
    tween(opacity(ribbon)).to(0.12, { opacity: 255 }).start();
    tween(ribbon)
      .to(0.24, { scale: new Vec3(0.94, 0.94, 1) }, { easing: 'quadIn' })
      .call(() => {
        if (!live()) return;
        // 落地这一下：屏幕震、金色放射光炸开、冲击波，两个下角往上喷彩纸铺满全屏
        fx.trauma(c, 0.5, 16);
        buzz('medium');
        fx.rayBurst(c, 0, ribbonY, Math.hypot(Screen.W, Screen.H) * 1.1, COLOR.yellow, 0.7, 150);
        fx.ring(c, 0, ribbonY, 120, 900, COLOR.yellow, 0.5);
        fx.confetti(c, -Screen.W / 2 + 40, ribbonY - 40, 30, 420);
        fx.confetti(c, Screen.W / 2 - 40, ribbonY - 40, 30, 420);
        fx.cannon(c, -Screen.W / 2 - 10, Screen.bottom + 200, 72, 40, 1350);
        fx.cannon(c, Screen.W / 2 + 10, Screen.bottom + 200, 108, 40, 1350);
      })
      .to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    sfx('win');

    // 2. 宝箱弹出来：压扁、拉长、回弹
    at(chest, 0, chestC);
    chest.setScale(0.2, 0.2, 1);
    opacity(chest).opacity = 0;
    tween(opacity(chest)).delay(0.15).to(0.1, { opacity: 255 }).start();
    tween(chest)
      .delay(0.15)
      .to(0.2, { scale: new Vec3(1.18, 0.86, 1) }, { easing: 'quadOut' })
      .to(0.1, { scale: new Vec3(0.92, 1.1, 1) })
      .to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();

    // 3. 三颗星：灰色星位先在，金星从宝箱处转着飞上去依次落位
    stars.forEach((st, i) => {
      const [sx, sy] = starPos[i];
      const slot = img(c, 'icon/star', st.getComponent(UITransform)?.width ?? 120, st.getComponent(UITransform)?.height ?? 120, 'slot');
      at(slot, sx, sy);
      (slot.getComponent(Sprite) as Sprite).grayscale = true;
      opacity(slot).opacity = 110;
      slot.setSiblingIndex(st.getSiblingIndex());
      st.active = true;
      opacity(st).opacity = 0;
      // 没拿到的那颗：灰色星位留着，不飞、不响
      if (i >= got) return;
      fx.delay(c, at0('starAt') + i * at0('starGap'), () => {
        if (!live()) return;
        at(st, 0, chestY);
        st.setScale(0.3, 0.3, 1);
        st.angle = -200;
        opacity(st).opacity = 255;
        tween(st)
          .to(0.32, { position: new Vec3(sx, sy, 0), scale: new Vec3(1.3, 1.3, 1), angle: 0 }, { easing: 'quadOut' })
          .call(() => {
            if (!live()) return;
            fx.ring(c, sx, sy, 60, 260, COLOR.yellow);
            fx.sparkle(c, sx, sy, 10, 120, COLOR.yellow, 36);
            fx.glowPop(c, sx, sy, 300, COLOR.yellow, 0.3, 200);
            fx.trauma(c, 0.2, 12);
            // 三颗星三个音：do、mi、sol，一颗比一颗高
            sfx('star');
            sfx('hit', [0, 2, 3][i] ?? 3, 0.8);
            buzz('light');
          })
          .to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start();
      });
    });

    // 4. 宝箱越晃越大，弹开：白光一闪、光芒放大、火花、两边的角色跳一下
    const shakeAt = at0('chestAt');
    const openAt = shakeAt + at0('chestShake');
    if (d.chest) {
      tween(chest)
        .delay(shakeAt)
        .to(0.06, { angle: 5, scale: new Vec3(1.03, 1.03, 1) })
        .to(0.07, { angle: -7, scale: new Vec3(1.06, 1.06, 1) })
        .to(0.07, { angle: 9, scale: new Vec3(1.09, 1.09, 1) })
        .to(0.08, { angle: -11, scale: new Vec3(1.12, 1.12, 1) })
        .to(0.06, { angle: 0, scale: new Vec3(1.16, 1.16, 1) })
        .call(() => {
          if (!live()) return;
          setImg(chest, 'icon/chest_open', chestS, chestS);
          fx.flash(c, Screen.W, Screen.H, 150);
          fx.rayBurst(c, 0, chestY, Math.hypot(Screen.W, Screen.H), COLOR.yellow, 0.6, 170);
          fx.sparkle(c, 0, chestY, 18, 240, COLOR.yellow, 44);
          fx.ring(c, 0, chestY, 100, 480, COLOR.yellow);
          fx.ring(c, 0, chestY, 140, 1100, COLOR.white, 0.5);
          fx.trauma(c, 0.45, 16);
          buzz('heavy');
          sfx('chest');
          extras.forEach((e, i) => {
            e.active = true;
            fx.popIn(e, 0.25 + i * 0.08, 0.25, rowK);
          });
        })
        .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
        .start();
    } else {
      fx.delay(c, openAt, () => {
        if (!live()) return;
        extras.forEach((e, i) => {
          e.active = true;
          fx.popIn(e, i * 0.08, 0.25, rowK);
        });
      });
    }
    opacity(rays).opacity = 0;
    rays.setScale(0.4, 0.4, 1);
    tween(opacity(rays)).delay(openAt).to(0.25, { opacity: 255 }).start();
    tween(rays).delay(openAt).to(0.35, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    for (const [f, sx] of [[left, 1], [right, -1]] as const) {
      fx.delay(c, openAt, () => {
        if (!live()) return;
        const p = f.position.clone();
        tween(f)
          .to(0.14, { position: new Vec3(p.x, p.y + 50, 0), scale: new Vec3(sx * 0.9, 1.12, 1) }, { easing: 'quadOut' })
          .to(0.18, { position: p, scale: new Vec3(sx * 1.1, 0.9, 1) }, { easing: 'quadIn' })
          .to(0.12, { scale: new Vec3(sx, 1, 1) })
          .call(() => fx.bob(f, 10, sx > 0 ? 1.8 : 2.1))
          .start();
      });
    }

    // 5. 奖励条从下面滑上来；金币从星星那里撒下来飞进金币图标，数字滚动，滚完弹一下
    const pillY0 = rowY;
    at(pill, 0, pillY0 - 60);
    opacity(pill).opacity = 0;
    tween(pill).delay(at0('coinsAt')).to(0.25, { position: new Vec3(0, pillY0, 0) }, { easing: 'backOut' }).start();
    tween(opacity(pill)).delay(at0('coinsAt')).to(0.2, { opacity: 235 }).start();
    if (r.rewarded) {
      const roll = at0('coinsRoll');
      const coinAt = at0('coinsAt') + 0.1;
      fx.delay(c, coinAt, () => {
        if (!live()) return;
        const ci = coinIcon.worldPosition;
        const lp = (c.getComponent(UITransform) as UITransform).convertToNodeSpaceAR(ci.clone());
        for (let i = 0; i < 10; i++) {
          const cn = img(c, 'icon/coin', 54, 54, 'flyCoin');
          at(cn, starPos[1][0] + (Math.random() - 0.5) * 160, starPos[1][1] - 40 + (Math.random() - 0.5) * 60);
          fx.flyArc(cn, lp.x, lp.y, 0.45 + i * 0.03, 60, 'quadIn', () => {
            cn.destroy();
            if (i % 3 === 0) {
              sfx('coin');
              buzz('light');
            }
            if (!coinIcon.isValid) return;
            Tween.stopAllByTarget(coinIcon);
            coinIcon.setScale(1.25, 1.25, 1);
            tween(coinIcon).to(0.1, { scale: new Vec3(1, 1, 1) }).start();
          });
        }
      });
      fx.countUp(coinLabel, 0, r.coins, roll, (v) => `+${v}`, coinAt + 0.15);
      fx.delay(c, coinAt + 0.15 + roll, () => {
        if (!live()) return;
        Tween.stopAllByTarget(coinLabel.node);
        coinLabel.node.setScale(1.35, 1.35, 1);
        tween(coinLabel.node).to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
      });
    }

    // 6. 按钮从下往上依次升起
    fx.delay(c, at0('buttonsAt'), () => {
      if (!live()) return;
      buttons.forEach((b, i) => {
        b.active = true;
        at(b, b.position.x, btnHome[i] - 90);
        opacity(b).opacity = 0;
        tween(b)
          .delay(i * 0.07)
          .to(0.28, { position: new Vec3(b.position.x, btnHome[i], 0) }, { easing: 'backOut' })
          .start();
        tween(opacity(b)).delay(i * 0.07).to(0.18, { opacity: 255 }).start();
      });
      fx.delay(c, 0.5, () => live() && fx.breathe(next.node, 0.04, 1.2));
    });
    // 常驻：星星周围隔一会闪一颗星光（演出播完、跳过之后都在）
    const twinkle = () => {
      if (!c.activeInHierarchy) return;
      const [sx, sy] = starPos[Math.floor(Math.random() * Math.max(1, got))];
      fx.sparkle(c, sx + (Math.random() - 0.5) * 110, sy + (Math.random() - 0.5) * 90, 3, 44, COLOR.yellow, 28);
      fx.delay(c, 0.5 + Math.random() * 0.5, twinkle);
    };
    fx.delay(c, 1.8, twinkle);
    // 收尾：连击送的卡、宝箱开出的卡翻面；之后点击不再跳
    fx.delay(c, at0('buttonsAt') + 0.45, () => {
      if (!live()) return;
      this.skipTo = null;
      this.reveal();
    });
  }
}
