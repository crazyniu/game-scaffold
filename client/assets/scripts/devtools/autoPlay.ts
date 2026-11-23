// 自动玩（测试模式才有：设置里的「自动玩」，devtools/testMode.ts；调试用，字直接写）。选从第几关开始，机器人一直往下打：
// 过关后等结算页播完，自己点「下一关」（和真人点一样走 Flow.afterResult，插屏照 ads.json 的频控出，模拟插屏 1.5 秒后自己关）；
// 输了不弹复活和失败窗，记一次失败后重打这一关（连输照样降档）；打到最后一关回主页。屏幕左边一直挂着「停止自动玩」。
// 启动参数 ?autoplay=1&level=N（./run.sh auto N）走的是同一套。
import { Node } from 'cc';
import { App } from '../services/app';
import * as fx from '../ui/fx';
import { COLOR, at, button, onTap, slice, text } from '../ui/kit';
import { closeAllPopups, openPopup } from '../ui/popup';
import { Screen } from '../ui/screen';
import { ui } from '../ui/shell';
import * as TestMode from './testMode';

let stopNode: Node | null = null;

/** 设置里出不出「自动玩」：测试模式打开了才有（设置标题 10 秒内连点 10 下，devtools/testMode.ts；上架包也能开） */
export function enabled(): boolean {
  return TestMode.isOn();
}

/** 从第 level 关开始自动玩 */
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
  showStop();
  ui.go('game', { level: id });
}

export function stop(): void {
  App.flags.autoplay = false;
  stopNode?.destroy();
  stopNode = null;
  ui.toast('已停止自动玩，这一关接着自己玩');
}

/** 屏幕左边的「停止自动玩」：挂在最上层，换页也在；自动玩结束（打到最后一关）自己收起 */
export function showStop(): void {
  stopNode?.destroy();
  const b = button(ui.toasts, { color: 'red', w: 220, h: 72, label: '停止自动玩', fontSize: 28, onTap: () => stop() });
  at(b.node, -Screen.W / 2 + 130, Screen.top - 300);
  stopNode = b.node;
  const watch = (): void => {
    if (!stopNode || !stopNode.isValid) return;
    if (!App.flags.autoplay) {
      stopNode.destroy();
      stopNode = null;
      return;
    }
    fx.delay(stopNode, 0.5, watch);
  };
  fx.delay(stopNode, 0.5, watch);
}

/** 选从第几关开始的小窗：中间的关卡号点一下弹数字键盘直接输，两边 ±1、±10 微调 */
export function popup(): void {
  let level = Math.max(1, Math.min(App.config.levelCount, App.save.data.level));
  const p = openPopup({ w: 620, h: 470, title: '自动玩' });
  const box = slice(p.body, 'kit/capsule', 300, 84, 'level');
  at(box, 0, 150);
  const label = text(box, '', 40, { color: COLOR.navy });
  const show = () => (label.string = `从第 ${level} 关开始`);
  show();
  onTap(box, () =>
    keypad(App.config.levelCount, (v) => {
      level = v;
      show();
    }),
  );
  const steps = [-10, -1, 1, 10];
  steps.forEach((d, i) => {
    const b = button(p.body, {
      color: 'blue',
      w: 120,
      h: 88,
      label: d > 0 ? `+${d}` : String(d),
      fontSize: 34,
      onTap: () => {
        level = Math.max(1, Math.min(App.config.levelCount, level + d));
        show();
      },
    });
    at(b.node, (i - 1.5) * 136, 40);
  });
  const note = text(p.body, '点关卡号可以直接输。过关自动点下一关，输了重打\n广告照真实规则出，模拟插屏自己关', 26);
  at(note.node, 0, -70);
  const go = button(p.body, { color: 'green', w: 420, h: 100, label: '开始', fontSize: 40, onTap: () => start(level) });
  at(go.node, 0, -170);
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
