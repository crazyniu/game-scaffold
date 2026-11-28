// 广告测试页（设置里的入口，测试模式里可见，上架包也能开；docs/01，调试用可朴素）：
// 列出全部广告位，可单独触发；今日展示次数、插屏频控状态；可重置频控；可切换「广告可用 / 不可用」。
// 手机上还显示原生广告状态：SDK 启动没有、同意拿没拿到、最近一次拉广告失败的错误码。
import { Node, UITransform } from 'cc';
import * as Meta from '../core/meta/meta';
import { PlatformDebug } from '../platform/platformDebug';
import { App } from '../services/app';
import { adNow } from '../services/clock';
import { tr } from '../ui/i18n';
import { COLOR, at, box, button, lazyImg, slice, text } from '../ui/kit';
import { Scroller } from '../ui/scroll';
import { Screen } from '../ui/screen';
import { Page, pageHead, ui } from '../ui/shell';

export class AdTestPage extends Page {
  private root!: Node;
  private view: Node | null = null;

  build(root: Node): void {
    this.root = root;
    const bgH = Math.max(Screen.H, Screen.W * 1.5);
    lazyImg(root, 'bg/home', (bgH * 1024) / 1536, bgH);
  }

  override show(): void {
    this.render();
  }

  override refresh(): void {
    this.render();
  }

  private render(): void {
    const p = App.platform;
    const dbg = p instanceof PlatformDebug ? p : null;
    const s = App.save.data;
    this.view?.destroy();
    const v = box('view', this.root, Screen.W, Screen.H);
    this.view = v;
    const top = Screen.headTop;
    pageHead(v, tr('UI_AD_TEST'));

    // 开关 + 频控
    const on = p.adsAvailable();
    const tg = button(v, { color: on ? 'green' : 'gray', w: 330, h: 84, label: on ? '广告：可用' : '广告：不可用', fontSize: 34, onTap: () => {
      if (dbg) dbg.adsOn = !dbg.adsOn;
      this.render();
    } });
    at(tg.node, -175, top - 200);
    const reset = button(v, { color: 'blue', w: 330, h: 84, label: '重置频控', fontSize: 34, onTap: () => {
      s.ads = { interstitialAt: -1e9, interstitialLevel: -1e9, rewardedAt: -1e9 };
      App.save.write();
      ui.toast('频控已重置');
      this.render();
    } });
    at(reset.node, 175, top - 200);
    const can = Meta.shouldShowInterstitial(s, App.config.ads, s.level, adNow(s.ads));
    const st = text(v, `插屏：${can ? '现在会弹' : '频控中'} · 上次插屏关 ${s.ads.interstitialLevel} · 第 ${s.level} 关`, 26, { width: 680 });
    at(st.node, 0, top - 280);
    // 原生广告状态（手机上查「为什么没有广告」：错误码 3 没填充、2 网络、1 请求不对、0 内部错误；consent = 问同意失败）
    // 一段字、左上角对齐，长的错误说明自动折行，下面的列表按实际高度往下排
    let statusH = 0;
    const lines = p.adStatus();
    if (lines.length > 0) {
      const l = text(v, lines.join('\n'), 22, { width: 680, align: 'left', color: COLOR.yellow });
      const t = l.node.getComponent(UITransform) as UITransform;
      t.setAnchorPoint(0, 1);
      l.updateRenderData(true);
      statusH = t.height + 10;
      at(l.node, -340, top - 310);
    }

    // 广告位列表
    const y0 = top - 330 - statusH;
    const y1 = Screen.bottom + 20;
    const sc = new Scroller(v, Screen.W, y0 - y1);
    at(sc.node, 0, (y0 + y1) / 2);
    const ids = Object.keys(App.config.ads.placements);
    ids.forEach((id, i) => {
      const type = App.config.ads.placements[id].type;
      const row = slice(sc.content, 'kit/row_blue', 690, 110, id);
      at(row, 0, -70 - i * 122);
      at(text(row, id, 32, { align: 'left' }).node, -320, 16);
      at(text(row, `${type} · 今日 ${dbg?.shown[id] ?? 0} 次`, 24, { align: 'left', color: COLOR.yellow }).node, -320, -24);
      const go = button(row, { color: 'green', w: 160, h: 76, label: '触发', fontSize: 32, onTap: async () => {
        if (type === 'rewarded') {
          const r = await p.showRewarded(id);
          ui.toast(`${id}：${r}`);
        } else if (type === 'interstitial') {
          if (await p.showInterstitial(id)) {
            Meta.markInterstitial(s, s.level, adNow());
            App.save.write();
          } else ui.toast(`${id}：没播出来`);
        } else {
          p.showBanner(id);
          setTimeout(() => p.hideBanner(), 3000);
        }
        this.render();
      } });
      at(go.node, 245, 0);
    });
    sc.setContentHeight(ids.length * 122 + 20);
  }
}
