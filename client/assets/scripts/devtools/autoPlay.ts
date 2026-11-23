// 机器人代打（测试模式才有：设置里的「难度调试 · 机器人代打」进调试页，点「机器人代打（从这关起）」；devtools/testMode.ts，调试用，字直接写）。
// 机器人从这一关起一直往下打，像真人一样点（每步停顿随机，gameView.ts），画面上不出任何字、不挂按钮（录屏、直播用）：
// 过关后等结算页播完，自己点「下一关」（和真人点一样走 Flow.afterResult，插屏照 ads.json 的频控出，模拟插屏 1.5 秒后自己关）；
// 输了不弹复活和失败窗，记一次失败后重打这一关（连输照样降档）；打到最后一关回主页。停：暂停 → 回主页。
// 启动参数 ?autoplay=1&level=N（./run.sh auto N）走的是同一套。
import { App } from '../services/app';
import { COLOR, at, button, text } from '../ui/kit';
import { closeAllPopups, openPopup } from '../ui/popup';
import { ui } from '../ui/shell';

/** 从第 level 关开始代打（调试页「机器人代打（从这关起）」） */
export function start(level: number): void {
  const s = App.save.data;
  const id = Math.max(1, Math.min(App.config.levelCount, Math.trunc(level)));
  // 按真实进度玩的时候这一关可能还没解锁：和启动参数 ?level= 一样，把进度挪到这一关（只有测试模式能走到这里）
  if (id > s.level) {
    s.level = id;
    App.save.write();
  }
  App.flags.autoplay = true;
  App.flags.autoTo = 0;
  closeAllPopups();
  ui.go('game', { level: id });
}

/**
 * 数字键盘（调试用，自己画的，不用系统输入框——Cocos 的 EditBox 在网页上会把数字摆到框外）：输完点「去」回调 1–max 里的数
 */
export function keypad(max: number, done: (v: number) => void): void {
  let typed = '';
  const p = openPopup({ w: 560, h: 640, title: '第几关' });
  const shown = text(p.body, '', 52, { color: COLOR.navy });
  at(shown.node, 0, 230);
  const show = () => (shown.string = typed || `（1–${max}）`);
  show();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '删', '0', '去'];
  keys.forEach((k, i) => {
    const b = button(p.body, {
      color: k === '去' ? 'green' : 'blue',
      w: 150,
      h: 96,
      label: k,
      fontSize: 40,
      onTap: () => {
        if (k === '删') typed = typed.slice(0, -1);
        else if (k === '去') {
          const v = parseInt(typed, 10);
          p.close();
          if (Number.isFinite(v)) done(Math.max(1, Math.min(max, v)));
          return;
        } else if (typed.length < 4) typed = (typed + k).replace(/^0+/, '');
        show();
      },
    });
    at(b.node, ((i % 3) - 1) * 165, 110 - Math.floor(i / 3) * 110);
  });
}
