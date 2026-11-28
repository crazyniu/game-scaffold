// 七日签到弹窗（docs/01）：7 天格子，今天高亮，领过的打勾；
// 「领取」或「看广告双倍领取」（宝箱则多开一个）；先领后看广告也能翻倍，每天一次。
import { Node } from 'cc';
import type { SignInDay } from '../core/config';
import * as SignIn from '../core/meta/signIn';
import { Rng } from '../core/rng/rng';
import { App } from '../services/app';
import { now, today } from '../services/clock';
import * as fx from '../ui/fx';
import { tr } from '../ui/i18n';
import { at, button, fmt, img, slice, text } from '../ui/kit';
import { openPopup } from '../ui/popup';
import { PrizeItem, cardItem, offerAd, rewardPopup, watchAd } from '../ui/popups';

const rng = new Rng(Date.now() >>> 0);

function dayIcon(d: SignInDay): [string, string] {
  if (d.bigChest) return ['icon/chest_daily_open', tr('SIGNIN_BIG_CHEST')];
  if (d.chest) return ['icon/chest', tr('SIGNIN_CHEST')];
  if (d.coins) return ['icon/coin', fmt(d.coins)];
  if (d.wheel) return ['icon/entry_wheel', `+${d.wheel}`];
  if (d.skill) return ['icon/skill_shuffle', `×${d.skill}`];
  return ['icon/gift', ''];
}

function items(r: SignIn.SignInResult): PrizeItem[] {
  const out: PrizeItem[] = [];
  if (r.coins) out.push({ icon: 'icon/coin', amount: fmt(r.coins) });
  if (r.wheel) out.push({ icon: 'icon/entry_wheel', amount: `+${r.wheel}` });
  for (const s of r.skills) if (s) out.push({ icon: `icon/skill_${s}`, amount: '×1' });
  for (const c of r.cards) out.push(cardItem(c));
  if (r.unlimited) out.push({ icon: 'icon/heart_inf', amount: tr('UI_MINUTES', Math.round(r.unlimited / 60)) });
  return out;
}

export function signInPopup(changed: () => void): void {
  const s = App.save.data;
  const eco = App.config.eco;
  const days = eco.signInDays;
  const p = openPopup({ w: 680, h: 650, title: tr('UI_SIGNIN') });
  const can = SignIn.canClaim(s, today());
  const next = SignIn.nextIndex(s, eco);
  const claimedThisRound = can ? next : next === 0 ? days.length : next;
  const cells: Node[] = [];
  days.forEach((d, i) => {
    const big = i === days.length - 1;
    const col = i % 4;
    const row = Math.floor(i / 4);
    const w = big ? 300 : 140;
    const cell = slice(p.body, i === next && can ? 'kit/cell_gold' : 'kit/row', w, 180, `day${i}`);
    // 上排 4 格；下排 3 格，第 7 天占两格宽。两排上下留的空一样
    at(cell, big ? 152 : row === 0 ? (col - 1.5) * 152 : -228 + col * 152, row === 0 ? 185 : -11);
    const lbl = text(cell, tr('UI_SIGNIN_DAY', i + 1), 26);
    at(lbl.node, 0, 64);
    const [icon, amount] = dayIcon(d);
    // 第 7 天的大宝箱往下放一点、小一号：原来 120 顶到了上面的「第 7 天」
    const ic = img(cell, icon, big ? 104 : 84, big ? 104 : 84, 'icon');
    at(ic, 0, big ? -4 : 4);
    if (amount) at(text(cell, amount, 26).node, 0, -62);
    if (i < claimedThisRound) {
      const ok = img(cell, 'kit/ic_check', 70, 70, 'check');
      at(ok, 0, 0);
      fx.popIn(ok, 0.1 + i * 0.04, 0.2);
    }
    cells.push(cell);
  });
  // 这一版没有广告时没有「看广告领双倍」
  // 拉不到广告时只有「领取」，不出看广告翻倍
  const hasAds = offerAd('rv_signin_double');
  const claim = (doubled: boolean) => {
    const day = today();
    const r = SignIn.claim(s, eco, App.config.cards, rng, day, now(), doubled);
    if (!r) return;
    App.save.write();
    p.close();
    changed();
    const its = items(r);
    rewardPopup(its, {
      onClose: changed,
      double: doubled || !hasAds
        ? undefined
        : {
            label: tr('UI_CLAIM_DOUBLE'),
            onTap: async () => {
              if (!(await watchAd('rv_signin_double'))) return;
              // 日期用领取那一刻的：广告跨零点播完，翻倍还是记在这条签到上（重新读日期会被当成「次日可领」拒掉，看了广告没奖励）
              const d = SignIn.doubleToday(s, eco, App.config.cards, rng, day, now(), r);
              App.save.write();
              changed();
              if (d) rewardPopup(items(d), { onClose: changed });
            },
          },
    });
  };
  if (can && !hasAds) {
    const b = button(p.body, { color: 'green', w: 400, h: 100, label: tr('UI_CLAIM'), onTap: () => claim(false) });
    at(b.node, 0, -215);
    fx.breathe(b.node, 0.04, 1.2);
  } else if (can) {
    const b = button(p.body, { color: 'green', w: 300, h: 100, label: tr('UI_CLAIM'), onTap: () => claim(false) });
    at(b.node, -160, -215);
    fx.breathe(b.node, 0.04, 1.2);
    const d = button(p.body, {
      color: 'yellow',
      w: 300,
      h: 100,
      icon: 'kit/ic_video',
      label: tr('UI_CLAIM_DOUBLE'),
      onTap: async () => {
        if (await watchAd('rv_signin_double')) claim(true);
      },
    });
    at(d.node, 160, -215);
  } else {
    // 今天领过了：同一个位置放一个灰色、点不了的按钮（原来只有一行字，看着像空着）
    const done = button(p.body, { color: 'gray', w: 400, h: 100, label: tr('UI_CLAIMED') });
    done.setEnabled(false);
    at(done.node, 0, -215);
  }
}
