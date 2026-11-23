// 模拟广告页（debug 平台，docs/01；调试用，可朴素）。
// 激励视频：全屏、广告位编号、5 秒倒计时；「看完」倒计时结束才亮，「中途关闭」「加载失败」随时可点。
// 插屏：1 秒后出现关闭键。Banner：底部占位色块。
import { Node } from 'cc';
import type { AdResult } from '../platform/platformBase';
import type { MockAdView } from '../platform/platformDebug';
import { App } from '../services/app';
import * as fx from './fx';
import { COLOR, at, blockInput, box, button, hex, text, tint } from './kit';
import { Screen } from './screen';

export function mockAdView(layer: () => Node): MockAdView {
  let bannerNode: Node | null = null;
  return {
    show(kind: 'rewarded' | 'interstitial', placement: string): Promise<AdResult> {
      return new Promise((resolve) => {
        const root = box('mockAd', layer(), Screen.W, Screen.H);
        blockInput(root);
        tint(root, Screen.W, Screen.H, hex('#101820'), 'bg');
        at(text(root, kind === 'rewarded' ? '模拟激励视频' : '模拟插屏', 64).node, 0, 260);
        at(text(root, placement, 40, { color: COLOR.yellow }).node, 0, 170);
        const done = (r: AdResult) => {
          root.destroy();
          resolve(r);
        };
        // 机器人代打（devtools/autoPlay.ts）：没人点，1.5 秒后自己关（插屏算播完，激励视频算看完）
        if (App.flags.autoplay) fx.delay(root, 1.5, () => root.isValid && done('done'));
        if (kind === 'interstitial') {
          const close = button(root, { color: 'gray', w: 260, h: 90, label: '关闭', onTap: () => done('done') });
          at(close.node, Screen.W / 2 - 170, Screen.top - 80);
          close.node.active = false;
          fx.delay(root, 1, () => (close.node.active = true));
          return;
        }
        let left = 5;
        const count = text(root, String(left), 120);
        at(count.node, 0, 20);
        const ok = button(root, { color: 'green', w: 420, h: 100, label: '看完', onTap: () => ok.enabled && done('done') });
        at(ok.node, 0, -180);
        ok.setEnabled(false);
        const tick = () => {
          if (!root.isValid) return;
          left -= 1;
          count.string = String(Math.max(left, 0));
          if (left <= 0) ok.setEnabled(true);
          else fx.delay(root, 1, tick);
        };
        fx.delay(root, 1, tick);
        const skip = button(root, { color: 'blue', w: 420, h: 100, label: '中途关闭', onTap: () => done('skipped') });
        at(skip.node, 0, -300);
        const fail = button(root, { color: 'red', w: 420, h: 100, label: '加载失败', onTap: () => done('unavailable') });
        at(fail.node, 0, -420);
      });
    },
    banner(placement: string | null): void {
      bannerNode?.destroy();
      bannerNode = null;
      if (!placement) return;
      bannerNode = tint(layer(), Screen.W, 110, hex('#5A6B80'), 'banner');
      at(bannerNode, 0, Screen.bottom + 55);
      at(text(bannerNode, `Banner ${placement}`, 30).node, 0, 0);
    },
  };
}
