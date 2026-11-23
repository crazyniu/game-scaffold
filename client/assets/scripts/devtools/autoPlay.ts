// 自动玩（开发版才有：设置里的「自动玩」；调试用，字直接写）。选从第几关开始，机器人一直往下打：
// 过关后等结算页播完，自己点「下一关」（和真人点一样走 Flow.afterResult，插屏照 ads.json 的频控出，模拟插屏 1.5 秒后自己关）；
// 输了不弹复活和失败窗，记一次失败后重打这一关（连输照样降档）；打到最后一关回主页。屏幕左边一直挂着「停止自动玩」。
// 启动参数 ?autoplay=1&level=N（./run.sh auto N）走的是同一套。
import { Node } from 'cc';
import { App } from '../services/app';
import * as fx from '../ui/fx';
import { at, button, text } from '../ui/kit';
import { closeAllPopups, openPopup } from '../ui/popup';
import { Screen } from '../ui/screen';
import { ui } from '../ui/shell';

let stopNode: Node | null = null;

/** 设置里出不出「自动玩」：开发版（./run.sh 打的包）才有，./package.sh 打的正式包没有 */
export function enabled(): boolean {
  return App.platform.isDevBuild();
}

/** 从第 level 关开始自动玩 */
export function start(level: number): void {
  const s = App.save.data;
  const id = Math.max(1, Math.min(App.config.levelCount, Math.trunc(level)));
  // 按真实进度玩的时候这一关可能还没解锁：和启动参数 ?level= 一样，把进度挪到这一关（只有开发版能走到这里）
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

/** 选从第几关开始的小窗 */
export function popup(): void {
  let level = Math.max(1, Math.min(App.config.levelCount, App.save.data.level));
  const p = openPopup({ w: 620, h: 470, title: '自动玩' });
  const label = text(p.body, '', 44);
  at(label.node, 0, 150);
  const show = () => (label.string = `从第 ${level} 关开始`);
  show();
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
  const note = text(p.body, '过关自动点下一关，输了重打\n广告照真实规则出，模拟插屏自己关', 26);
  at(note.node, 0, -70);
  const go = button(p.body, { color: 'green', w: 420, h: 100, label: '开始', fontSize: 40, onTap: () => start(level) });
  at(go.node, 0, -170);
}
