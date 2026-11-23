// 难度调试页（底座，换游戏照用；docs/10 第 9 节、docs/01）。设置里的入口，开发版才有（levelLab.ts）。
// 调试用：版面朴素、字直接写、不进翻译表。页面内容超出屏幕就上下滚动。
// - 整体三档：所有关立刻生效，改什么由游戏的 onTier 决定
// - 单关：每关按「正常打法能过几成」存了好几档，挑一档顶替包里那一关，马上试玩
// - 演示：电脑按关卡里存的路线打一遍（打得完 = 这一档一定过得去）
// - 机器人代打：从这关起一关接一关打，画面上不出任何字（录屏、直播用）
// 和具体游戏有关的（怎么开局、怎么演示、加金币之类的作弊按钮）都由 LabHooks 传进来
import { Node } from 'cc';
import { COLOR, at, box, button, lazyImg, onTap, slice, text } from '../ui/kit';
import { keypad } from './autoPlay';
import { Scroller } from '../ui/scroll';
import { Screen } from '../ui/screen';
import { Page, pageHead, ui } from '../ui/shell';
import { lab } from './levelLab';

export interface LabHooks {
  /** 玩家现在打到第几关（进页时默认翻到这一关附近） */
  progress(): number;
  /** 一共几关（输入关卡号时的上限） */
  levelCount(): number;
  /** 试玩这一关 */
  play(id: number): void;
  /** 演示：电脑按关卡里存的路线（参考解）打一遍，打完回调试页；不给就不出「看路线」 */
  demo?(id: number): void;
  /** 机器人从这一关起一关接一关连打（过关自动下一关、输了重打）；不给就不出这个按钮 */
  auto?(id: number): void;
  /** 整体档的说明（切换后显示在下面），如「暂存槽少 1 格，连击窗口 1.5 秒」 */
  tierNote?(tier: number): string;
  /** 作弊按钮（金币、生命、进度……），三个一排；id 是页面上正在看的关 */
  extras?: { label: string; run: (id: number) => void; devOnly?: boolean }[];
  /** 是不是开发版：devOnly 的作弊按钮（金币、生命、进度）只在开发版出，上架包的测试模式里没有 */
  devBuild?(): boolean;
}

const ROW_H = 84;
const ROW_STEP = 92;

export class LabPage extends Page {
  private root!: Node;
  private view: Node | null = null;
  private scroller: Scroller | null = null;
  private level = 0;
  private note = '';

  constructor(private readonly hooks: LabHooks) {
    super();
  }

  build(root: Node): void {
    this.root = root;
    const bgH = Math.max(Screen.H, Screen.W * 1.5);
    lazyImg(root, 'bg/home', (bgH * 1024) / 1536, bgH);
  }

  override show(): void {
    if (this.level === 0) {
      const ids = lab.ids();
      const at0 = this.hooks.progress();
      this.level = ids.find((x) => x >= at0) ?? ids[0] ?? at0;
    }
    this.render(false);
  }

  override refresh(): void {
    this.render(true);
  }

  /** 关卡号：白底框里是现在这一关，点一下弹数字键盘（autoPlay.keypad；系统输入框在网页上把数字摆到框外），输完跳到那一关 */
  private levelInput(parent: Node, x: number, y: number): Node {
    const n = slice(parent, 'kit/capsule', 120, 64, 'levelInput');
    at(n, x, y);
    text(n, String(this.level), 36, { color: COLOR.navy });
    onTap(n, () =>
      keypad(this.hooks.levelCount(), (v) => {
        this.level = v;
        this.note = '';
        this.render();
      }),
    );
    return n;
  }

  /** keep：重画时保留滚动位置（点了「用这档」之类的不要跳回顶上） */
  private render(keep = true): void {
    const offset = keep && this.scroller ? this.scroller.offsetNow : 0;
    this.view?.destroy();
    const v = box('view', this.root, Screen.W, Screen.H);
    this.view = v;
    pageHead(v, '难度调试');
    // 标题下面整块是滚动区
    const y0 = Screen.headTop - 110;
    const y1 = -Screen.H / 2 + 16;
    const sc = new Scroller(v, Screen.W, y0 - y1);
    at(sc.node, 0, (y0 + y1) / 2);
    this.scroller = sc;
    const c = sc.content;
    let y = -60;

    // 整体难度：所有关立刻生效
    const tierRow = slice(c, 'kit/row_blue', 690, 96, 'tier');
    at(tierRow, 0, y);
    at(text(tierRow, '整体', 30, { align: 'left' }).node, -320, 0);
    ([[1, '简单'], [0, '标准'], [-1, '困难']] as const).forEach(([t, name], i) => {
      const on = lab.tier === t;
      const b = button(tierRow, {
        color: on ? 'green' : 'blue',
        w: 150,
        h: 68,
        label: name,
        fontSize: 30,
        onTap: () => {
          lab.setTier(t);
          const more = this.hooks.tierNote?.(t);
          this.note = `整体难度：${name}${more ? `（${more}）` : ''}`;
          this.render();
        },
      });
      at(b.node, -60 + i * 160, 0);
    });
    y -= 112;

    // 第几关：有各档版本的关之间跳
    const ids = lab.ids();
    const row0 = slice(c, 'kit/row_blue', 690, 96, 'level');
    at(row0, 0, y);
    const custom = lab.picks.get(this.level);
    // 关卡号是一个输入框：点一下直接输入第几关，回车或点别处就跳过去（想直接测第 60 关）。
    // 没有各档版本的关也能跳，照样能看路线、试玩
    at(text(row0, '第', 34).node, -310, 0);
    at(this.levelInput(row0, -225, 0), -225, 0);
    at(text(row0, '关', 34).node, -140, 0);
    const step = (d: number) => {
      const i = ids.indexOf(this.level);
      if (ids.length > 0) this.level = ids[Math.max(0, Math.min(ids.length - 1, (i < 0 ? 0 : i) + d))];
      this.note = '';
      this.render();
    };
    at(button(row0, { color: 'blue', w: 130, h: 68, label: '上一关', fontSize: 28, onTap: () => step(-1) }).node, 120, 0);
    at(button(row0, { color: 'blue', w: 130, h: 68, label: '下一关', fontSize: 28, onTap: () => step(1) }).node, 270, 0);
    y -= 112;

    const info = lab.index[String(this.level)];
    if (!info) {
      at(text(c, '这一关没有各档版本（只给样品关生成了）', 28, { width: 680 }).node, 0, y);
      y -= 90;
    } else {
      // 每档一行（从容易到难）：正常打法能过几成、想清楚能过几成、路线最长连击；点「用这档」
      const vers = Object.keys(info.versions)
        .map(Number)
        .sort((a, b) => b - a);
      const using = custom ? custom.ver : info.base;
      for (const ver of vers) {
        const m = info.versions[String(ver)];
        const row = slice(c, 'kit/row_blue', 690, ROW_H, `p${ver}`);
        at(row, 0, y);
        const tag = ver === info.base ? '（包里）' : '';
        // 第三版尺子是想几步的玩家：标「认真玩」；第二版的档（没有 casual）是随手点的玩家量的，照旧标「正常打法」
        const main = m.casual === undefined ? '正常打法' : '认真玩';
        at(text(row, `${main}能过 ${m.natural}%${tag}`, 30, { align: 'left', color: ver === using ? COLOR.yellow : undefined }).node, -320, 14);
        const rand = m.casual === undefined ? '' : `随手点 ${m.casual}% · `;
        at(text(row, `${rand}想清楚 ${m.think}% · 连击最多 ${m.run}`, 22, { align: 'left' }).node, -320, -20);
        const b = button(row, { color: ver === using ? 'green' : 'blue', w: 150, h: 64, label: ver === using ? '在用' : '用这档', fontSize: 28, onTap: () => void this.use(ver) });
        at(b.node, 255, 0);
        y -= ROW_STEP;
      }
    }

    const note = text(c, this.note || (info ? `这关目标：认真玩 ${info.target}% 能过。挑一档马上试，或先看电脑打一遍` : ''), 26, { width: 680 });
    at(note.node, 0, y - 6);
    y -= 84;

    // 第一排：看路线（电脑按参考解打在用的这一档，一定能过）、试玩这一关
    const demo = this.hooks.demo;
    if (demo) at(button(c, { color: 'yellow', w: 330, h: 88, label: '看路线（一定能过）', fontSize: 28, onTap: () => demo(this.level) }).node, -175, y);
    at(button(c, { color: 'green', w: 330, h: 88, label: '试玩这一关', fontSize: 34, onTap: () => this.hooks.play(this.level) }).node, demo ? 175 : 0, y);
    y -= 108;
    // 第二排：有各档版本（levels_lab）时是「恢复包里的」
    if (info) {
      const back = button(c, {
        color: 'blue',
        w: 690,
        h: 88,
        label: '恢复包里的',
        fontSize: 30,
        onTap: () => {
          lab.unpick(this.level);
          this.note = `第 ${this.level} 关换回包里的版本`;
          this.render();
        },
      });
      at(back.node, 0, y);
      back.setEnabled(!!custom);
      y -= 108;
    }
    // 机器人代打：从这关起一关接一关打（过关自动下一关、输了重打），画面上不出字，录屏、直播用
    const auto = this.hooks.auto;
    if (auto) {
      at(button(c, { color: 'yellow', w: 690, h: 88, label: '机器人代打（从这关起）', fontSize: 32, onTap: () => auto(this.level) }).node, 0, y);
      y -= 70;
      at(text(c, '过关自动进下一关、输了重打；暂停后回主页就停', 24, { width: 680 }).node, 0, y);
      y -= 60;
    }

    const extras = (this.hooks.extras ?? []).filter((e) => !e.devOnly || !!this.hooks.devBuild?.());
    extras.forEach((e, i) => {
      const b = button(c, { color: 'yellow', w: 220, h: 80, label: e.label, fontSize: 28, onTap: () => e.run(this.level) });
      at(b.node, -235 + (i % 3) * 235, y - Math.floor(i / 3) * 96);
    });
    if (extras.length > 0) y -= Math.ceil(extras.length / 3) * 96;

    // 改过的关一览：截图发给开发就行
    const changed = Array.from(lab.picks.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([id, x]) => `第${id}关 ${lab.index[String(id)]?.versions[String(x.ver)]?.natural ?? x.ver}%`);
    if (changed.length > 0) {
      at(text(c, `已改：${changed.join('、')}`, 24, { width: 680, color: COLOR.yellow }).node, 0, y);
      y -= 60;
    }
    sc.setContentHeight(-y + 20);
    sc.scrollTo(offset);
  }

  private async use(ver: number): Promise<void> {
    ui.busy(true);
    try {
      await lab.pick(this.level, ver);
      const m = lab.index[String(this.level)]?.versions[String(ver)];
      this.note = `第 ${this.level} 关换成「能过 ${m ? m.natural : ver}%」的版本`;
    } catch (e) {
      console.warn('读不出这一档', e);
      this.note = '这一档读不出来';
    } finally {
      ui.busy(false);
    }
    if (this.view?.isValid) this.render();
  }
}
