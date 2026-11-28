// 界面搭建的基础件：节点、图片、九宫格、文字、按钮。界面全部由代码生成（docs/09）。
// 图片都是 3 倍图：显示尺寸 = 图片像素 / RES。九宫格的皮放在缩小 1/RES 的子节点上，角的粗细才对。
import {
  BlockInputEvents,
  Color,
  EventTouch,
  HorizontalTextAlignment,
  Label,
  Layers,
  Node,
  Sprite,
  SpriteFrame,
  Tween,
  UIOpacity,
  UITransform,
  Vec2,
  Vec3,
  VerticalTextAlignment,
  tween,
} from 'cc';
import { DEBUG } from 'cc/env';
import { frame, frameAsync, hasFrame, peek, uiFont } from './res';

export const RES = 3;

export const COLOR = {
  white: new Color(255, 255, 255, 255),
  navy: new Color(11, 42, 115, 255),
  ink: new Color(31, 86, 176, 255),
  dim: new Color(0, 18, 60, 160),
  yellow: new Color(255, 214, 64, 255),
  red: new Color(255, 76, 64, 255),
  green: new Color(100, 230, 60, 255),
  gray: new Color(150, 162, 180, 255),
  shadow: new Color(0, 20, 70, 140),
};

// ---------------------------------------------------------------- 面的「墨色」
// 设计规范（docs/09）：浅色卡片上用深藏青字、蓝色图标，深色底上白字；按钮各有自己的字色。
// 部件建出来时登记在节点上，文字、图标按最近的祖先自动取色，页面代码不用分别写。

export interface Ink {
  /** 正文色（代码里写 COLOR.white 或不写颜色时用它） */
  text: Color;
  /** 强调色（代码里写 COLOR.yellow 时用它；浅底上黄字看不清，换成深琥珀） */
  accent: Color;
  /** kit/ic_* 图标的染色；null = 保持原色（图标是 Codex 出的彩色图，目前都不染） */
  glyph: Color | null;
  /** 文字描边色（docs/03：白字加深色描边，浅色面上深色字不描边）；null = 不描边 */
  outline: Color | null;
  /** 不描边的字下面压的一道实色（平面按钮：白字 + 一道按钮下边的深色，不描边） */
  depth?: Color;
}

export const INK = {
  ink: hex('#1F56B0'),
  sub: hex('#5E86C0'),
  blue: hex('#1B6FD1'),
  amber: hex('#D98200'),
};

const ON_DARK: Ink = { text: COLOR.white, accent: COLOR.yellow, glyph: null, outline: COLOR.navy };
const ON_LIGHT: Ink = { text: INK.ink, accent: INK.amber, glyph: hex('#3F8DFF'), outline: null };
/** 平面的彩色部件（的新设计）：白字不描边，下面压一道和部件下边同色的实色 */
const flatInk = (o: string, accent: Color = COLOR.white): Ink => ({ text: COLOR.white, accent, glyph: null, outline: null, depth: hex(o) });
const ON_GREEN = flatInk('#268F1B');
const ON_BLUE = flatInk('#1E55C4');
const ON_AMBER = flatInk('#C47400');
const ON_RED = flatInk('#BC3320');
const ON_GRAY = flatInk('#7C889C');
/** 蓝色的标签牌、列表行、技能键：强调色还是黄 */
const ON_FLAT_BLUE = flatInk('#1A52BE', COLOR.yellow);
const ON_GOLD = flatInk('#C47400');

/** 部件 → 上面放的字用什么颜色 */
const PART_INK: Record<string, Ink> = {
  'skin/j_btn_green': ON_GREEN,
  'skin/j_btn_blue': ON_BLUE,
  'skin/j_btn_amber': ON_AMBER,
  'skin/j_btn_red': ON_RED,
  'skin/j_btn_gray': ON_GRAY,
  'skin/f_plate_blue': ON_FLAT_BLUE,
  'skin/f_dock': ON_LIGHT,
  'skin/f_hud': ON_DARK,
  'skin/f_card': ON_LIGHT,
  'skin/f_card_s': ON_LIGHT,
  'skin/f_popup': ON_LIGHT,
  'skin/f_inset': ON_LIGHT,
  'skin/f_block': ON_FLAT_BLUE,
  'skin/f_block_s': ON_FLAT_BLUE,
  'skin/f_block_gold': ON_GOLD,
  'skin/f_block_gold_s': ON_GOLD,
  'skin/f_key_blue': ON_BLUE,
  'skin/f_key_green': ON_GREEN,
  'skin/f_key_red': ON_RED,
  'skin/f_ribbon': ON_RED,
  'skin/f_node_green': ON_GREEN,
  'skin/f_node_blue': ON_BLUE,
  'skin/f_node_purple': flatInk('#6B3CC4'),
  'skin/f_node_gray': ON_GRAY,
};

const inks = new WeakMap<Node, Ink>();
/** 单色图标节点（跟着面染色） */
const glyphs = new WeakSet<Node>();

export function setInk(n: Node, ink: Ink): void {
  inks.set(n, ink);
}

/** 最近的登记过的祖先决定墨色；都没有 = 深色底 */
export function inkOf(n: Node | null): Ink {
  for (let p = n; p; p = p.parent) {
    const k = inks.get(p);
    if (k) return k;
  }
  return ON_DARK;
}

export const DARK_INK = ON_DARK;
export const LIGHT_INK = ON_LIGHT;
/** 染了色的白色部件（稀有度名牌）上：白字、不描边 */
export const WHITE_INK: Ink = { text: COLOR.white, accent: COLOR.yellow, glyph: null, outline: null };

/** 界面上的数字：取整，不加千分位逗号（100449 就显示 100449） */
export function fmt(n: number): string {
  return String(Math.round(n));
}

/** 顶栏、页头上的金币数：最多显示 9999（最多显示 4 个 9），条的宽度按它定 */
export const COINS_SHOWN_MAX = 9999;
export function fmtCoins(n: number): string {
  return fmt(Math.min(COINS_SHOWN_MAX, n));
}

export function hex(s: string, a = 255): Color {
  const n = parseInt(s.replace('#', ''), 16);
  return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}

/** 空节点。w、h 是设计单位 */
export function box(name: string, parent: Node | null = null, w = 0, h = 0): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  if (parent) parent.addChild(n);
  return n;
}

export function size(n: Node, w: number, h: number): Node {
  (n.getComponent(UITransform) as UITransform).setContentSize(w, h);
  return n;
}

export function sizeOf(n: Node): { w: number; h: number } {
  const t = n.getComponent(UITransform) as UITransform;
  return { w: t.width, h: t.height };
}

export function at(n: Node, x: number, y: number): Node {
  n.setPosition(x, y, 0);
  return n;
}

/** 普通图片。不给尺寸就按图的显示尺寸；只给宽就按比例。图还没读（卡面、背景）就先占位、读到再显示 */
export function img(parent: Node | null, path: string, w?: number, h?: number, name = path): Node {
  path = IMG_ALIAS[path] ?? path;
  const n = box(name, parent);
  const sp = n.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  showFrame(n, path, w, h);
  const k = PART_INK[path];
  if (k) inks.set(n, k);
  // 平面的白色图标：在白色容器里染成蓝色，在彩色部件上保持白色
  if (path.startsWith('skin/f_g_')) {
    glyphs.add(n);
    const g = inkOf(parent).glyph;
    if (g) sp.color = g;
  }
  return n;
}

export function setFrame(n: Node, f: SpriteFrame | null, w?: number, h?: number): void {
  const sp = n.getComponent(Sprite) as Sprite;
  sp.spriteFrame = f;
  if (!f) return;
  const fw = f.originalSize.width / RES;
  const fh = f.originalSize.height / RES;
  const ww = w ?? (h !== undefined ? (fw * h) / fh : fw);
  const hh = h ?? (w !== undefined ? (fh * w) / fw : fh);
  size(n, ww, hh);
}

export function setImg(n: Node, path: string, w?: number, h?: number): void {
  showFrame(n, IMG_ALIAS[path] ?? path, w, h);
}

/** 节点最后一次要显示的图（按调用编号）：晚到的旧图不覆盖新图；对象池复用的节点换了尺寸，旧的回调也不会按旧尺寸改回去 */
const wanted = new WeakMap<Node, number>();
let wantSeq = 0;

/** 读好了就直接显示；没读的先按给的尺寸占位（没给尺寸就是 0），读到再显示 */
function showFrame(n: Node, path: string, w?: number, h?: number): void {
  const seq = ++wantSeq;
  wanted.set(n, seq);
  const f = peek(path);
  if (f) return setFrame(n, f, w, h);
  (n.getComponent(Sprite) as Sprite).spriteFrame = null;
  size(n, w ?? h ?? 0, h ?? w ?? 0);
  const load = (wait: number): void => {
    void frameAsync(path).then((sf) => {
      if (!n.isValid || wanted.get(n) !== seq) return;
      if (sf) return setFrame(n, sf, w, h);
      // 包里有这张图但这次没读下来（微信弱网、没预读的图）：节点还在、还要显示这张图就过一会儿再试，
      // 间隔逐次加倍、最多再试 5 次；节点销毁或换了别的图（seq 变了）就停
      if (hasFrame(path) && wait <= IMG_RETRY_MAX) setTimeout(() => load(wait * 2), wait * 1000);
    });
  };
  load(IMG_RETRY_FIRST);
}

const IMG_RETRY_FIRST = 3;
const IMG_RETRY_MAX = 48;

// ---- 特效小图的对象池（微信性能报告的建议：减少临时对象和垃圾回收）。
// 火花、水波、彩纸、冒泡这类一闪而过、源源不断的小图，播完不销毁，收回来下次接着用。
// 只给不带染色规则的图用（不在 PART_INK 里、不是 skin/f_g_ 图标）；取出时位置、缩放、角度、颜色、透明度都复位成新建时的样子。
const fxPool: Node[] = [];
const FX_POOL_MAX = 256;

/** 和 img() 一样建一张特效小图，但从池里取；播完用 recycleFx() 收回，不要 destroy() */
export function fxImg(parent: Node, path: string, w: number, h: number, name: string): Node {
  let n = fxPool.pop();
  while (n && !n.isValid) n = fxPool.pop();
  if (!n) return img(parent, path, w, h, name);
  n.name = name;
  n.setPosition(0, 0, 0);
  n.setScale(1, 1, 1);
  n.angle = 0;
  (n.getComponent(Sprite) as Sprite).color = Color.WHITE;
  const op = n.getComponent(UIOpacity);
  if (op) op.opacity = 255;
  parent.addChild(n);
  n.active = true;
  showFrame(n, IMG_ALIAS[path] ?? path, w, h);
  return n;
}

/** 收回 fxImg() 建的图：停掉它和它透明度上的动画，从父节点摘下放回池里（池满了才销毁） */
export function recycleFx(n: Node): void {
  if (!n.isValid) return;
  Tween.stopAllByTarget(n);
  const op = n.getComponent(UIOpacity);
  if (op) Tween.stopAllByTarget(op);
  if (fxPool.length >= FX_POOL_MAX) {
    n.destroy();
    return;
  }
  n.removeFromParent();
  fxPool.push(n);
}

/** 大图（背景、家园场景）：先建节点，读到再显示 */
export function lazyImg(parent: Node, path: string, w: number, h?: number): Node {
  const n = box(path, parent, w, h ?? w);
  const sp = n.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  const load = (wait: number): void => {
    void frameAsync(path).then((f) => {
      if (!n.isValid) return;
      if (f) {
        sp.spriteFrame = f;
        if (h === undefined) size(n, w, (f.originalSize.height * w) / f.originalSize.width);
        return;
      }
      // 包里有这张图但这次没读下来（微信断网）：节点还在就过一会儿再试，间隔逐次加倍、最长 60 秒。
      // 页面是缓存着复用的，不重试的话网好了也一直是空的
      if (hasFrame(path)) setTimeout(() => load(Math.min(wait * 2, 60)), wait * 1000);
    });
  };
  load(3);
  return n;
}

/**
 * 部件名 → 平面部件的图（docs/03；tools/art/flat_skin.py 程序画的）。页面代码写左边的名字：
 * plate = 横向三宫格（按高度缩放，圆角跟着高度走），nine = 九宫格（圆角、下边粗细固定）
 */
const ALIAS: Record<string, [string, 'plate' | 'nine']> = {
  // 容器：白色、不凸起，上面写深蓝字
  'kit/panel_glass': ['skin/f_card', 'nine'],
  'kit/capsule': ['skin/f_dock', 'plate'],
  // 容器里的格子：浅蓝
  'kit/row': ['skin/f_inset', 'nine'],
  // 凸起的蓝色块：列表行、商品卡、技能键
  'kit/panel_blue': ['skin/f_block', 'nine'],
  'kit/row_blue': ['skin/f_block', 'nine'],
  'kit/cell_gold': ['skin/f_block_gold', 'nine'],
  'kit/title_plate': ['skin/f_plate_blue', 'plate'],
  'kit/btn_green': ['skin/j_btn_green', 'plate'],
  'kit/btn_blue': ['skin/j_btn_blue', 'plate'],
  'kit/btn_yellow': ['skin/j_btn_amber', 'plate'],
  'kit/btn_red': ['skin/j_btn_red', 'plate'],
  'kit/btn_gray': ['skin/j_btn_gray', 'plate'],
  'kit/tag_red': ['skin/j_btn_red', 'plate'],
  'kit/tag_amber': ['skin/j_btn_amber', 'plate'],
  'kit/slot': ['skin/f_slot', 'nine'],
  'kit/slot_warn': ['skin/f_slot_warn', 'nine'],
  'kit/bar_track': ['skin/f_bar_track', 'plate'],
  'kit/bar_track_light': ['skin/f_bar_track_light', 'plate'],
  'kit/bar_yellow': ['skin/f_bar_yellow', 'plate'],
  'kit/bar_green': ['skin/f_bar_green', 'plate'],
  'kit/bar_blue': ['skin/f_bar_blue', 'plate'],
  'kit/bar_purple': ['skin/f_bar_purple', 'plate'],
  'kit/seg_bg': ['skin/f_bar_track_light', 'plate'],
  'kit/seg_on': ['skin/j_btn_blue', 'plate'],
};
/** img() 用的名字 → 平面部件的图 */
const IMG_ALIAS: Record<string, string> = {
  'kit/round_green': 'skin/f_key_green',
  'kit/round_red': 'skin/f_key_red',
  'kit/round_blue': 'skin/f_key_blue',
  'kit/dot_red': 'skin/f_dot',
  'kit/orb': 'skin/j_orb',
  'kit/orb_small': 'skin/j_orb',
  // 放在按钮、图标键上的图标：平面的白色图标
  'kit/ic_back': 'skin/f_g_back',
  'kit/ic_x': 'skin/f_g_x',
  'kit/ic_plus': 'skin/f_g_plus',
  'kit/ic_gear': 'skin/f_g_gear',
  'kit/ic_video': 'skin/f_g_video',
  'kit/ic_check': 'skin/f_check',
  'kit/ic_music': 'skin/f_g_music',
  'kit/ic_sound': 'skin/f_g_sound',
  'kit/ic_vibrate': 'skin/f_g_vibrate',
  'kit/ic_globe': 'skin/f_g_globe',
  'kit/ic_timer': 'skin/f_g_timer',
};
const plates = new WeakSet<Node>();

/** 九宫格的块又矮又小时换成小圆角的那一张 */
const SMALL: Record<string, string> = {
  'skin/f_card': 'skin/f_card_s',
  'skin/f_block': 'skin/f_block_s',
  'skin/f_block_gold': 'skin/f_block_gold_s',
};
function nineFor(path: string, w: number, h: number): string {
  return SMALL[path] && Math.min(w, h) < 150 ? SMALL[path] : path;
}

/** 九宫格：外层节点 w×h 管布局和子节点，皮在缩小 1/RES 的子节点上 */
export function slice(parent: Node | null, path: string, w: number, h: number, name = path): Node {
  const alias = ALIAS[path];
  if (alias?.[1] === 'plate') return plate(parent, alias[0], w, h, name);
  if (alias) path = nineFor(alias[0], w, h);
  const n = box(name, parent, w, h);
  const skin = box('skin', n, w * RES, h * RES);
  skin.setScale(1 / RES, 1 / RES, 1);
  const sp = skin.addComponent(Sprite);
  sp.type = Sprite.Type.SLICED;
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.spriteFrame = frame(path);
  size(skin, w * RES, h * RES);
  const k = PART_INK[path];
  if (k) inks.set(n, k);
  return n;
}

export function resizeSlice(n: Node, w: number, h: number): void {
  if (plates.has(n)) return resizePlate(n, w, h);
  size(n, w, h);
  const skin = n.getChildByName('skin');
  if (skin) size(skin, w * RES, h * RES);
}

export function setSlice(n: Node, path: string): void {
  const alias = ALIAS[path];
  if (plates.has(n)) return setPlate(n, alias ? alias[0] : path);
  if (alias) {
    const t = n.getComponent(UITransform) as UITransform;
    path = nineFor(alias[0], t.width, t.height);
  }
  const skin = n.getChildByName('skin');
  const sp = skin?.getComponent(Sprite);
  if (sp) sp.spriteFrame = frame(path);
}

/**
 * 位图部件（ui/skin，Codex 出的母版）：整张按高度等比缩放，只有中间一段横向拉伸，
 * 所以圆角、描边、高光在任何尺寸下都不变形（按钮越高圆角越大）。docs/03「界面部件」
 */
export function plate(parent: Node | null, path: string, w: number, h: number, name = path): Node {
  const n = box(name, parent, w, h);
  const skin = box('skin', n);
  const sp = skin.addComponent(Sprite);
  sp.type = Sprite.Type.SLICED;
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.spriteFrame = frame(path);
  plates.add(n);
  resizePlate(n, w, h);
  const k = PART_INK[path];
  if (k) inks.set(n, k);
  return n;
}

export function resizePlate(n: Node, w: number, h: number): void {
  size(n, w, h);
  const skin = n.getChildByName('skin');
  const f = skin?.getComponent(Sprite)?.spriteFrame;
  if (!skin || !f) return;
  const k = h / f.originalSize.height;
  size(skin, w / k, f.originalSize.height);
  skin.setScale(k, k, 1);
}

export function setPlate(n: Node, path: string): void {
  const sp = n.getChildByName('skin')?.getComponent(Sprite);
  if (!sp) return;
  sp.spriteFrame = frame(path);
  const t = n.getComponent(UITransform) as UITransform;
  resizePlate(n, t.width, t.height);
}

/** 纯色块（遮罩、压暗）：用白图染色，不是界面部件 */
export function tint(parent: Node, w: number, h: number, c: Color, name = 'tint'): Node {
  const n = img(parent, 'kit/white', w, h, name);
  (n.getComponent(Sprite) as Sprite).color = c;
  return n;
}

export interface TextOpts {
  color?: Color;
  /** 描边颜色；null = 不描边 */
  outline?: Color | null;
  outlineWidth?: number;
  shadow?: boolean;
  align?: 'left' | 'center' | 'right';
  /** 给了宽就自动换行 */
  width?: number;
  lineHeight?: number;
  bold?: boolean;
  /**
   * 高清倍数：字按 fontSize × sharp 渲染，再把节点缩回去。引擎按设计尺寸（750 宽）画字，到高分屏上会被放大发糊，大字最明显；
   * 给 2 就清楚了。用了它的字，节点缩放是 1 / sharp：不要再对这个节点 setScale(1) 或做缩放动画（要动就动它的父节点）
   */
  sharp?: number;
}

/**
 * 文字（docs/03）：颜色、描边按所在的面自动取——深色底与按钮上白字加深色描边，浅色卡片上深藏青字不描边；
 * 写 COLOR.white / COLOR.yellow 也按面换成对应的正文色 / 强调色；outline: null 强制不描边
 */
/** 描边、厚度投影各是字号的几分之一 */
const OUTLINE_DIV = 18;
const SHADOW_DIV = 26;
/** 平面按钮上的字，下面那道实色是字号的几分之一 */
const FLAT_DEPTH_DIV = 16;

export function text(parent: Node | null, s: string, fontSize: number, o: TextOpts = {}): Label {
  const k = o.sharp ?? 1;
  const design = fontSize;
  fontSize = Math.round(fontSize * k);
  const n = box('text', parent);
  const l = n.addComponent(Label);
  const font = uiFont();
  if (font) {
    l.useSystemFont = false;
    l.font = font;
  } else {
    l.isBold = true;
  }
  l.fontSize = fontSize;
  l.lineHeight = o.lineHeight !== undefined ? Math.round(o.lineHeight * k) : Math.round(fontSize * 1.25);
  const ink = inkOf(parent);
  l.color = inkColor(ink, o.color);
  const outline = o.outline === undefined ? ink.outline : o.outline;
  if (outline) {
    l.enableOutline = true;
    l.outlineColor = outline;
    // 描边约字号的 1/18（原来 1/12，字看着太粗太重）；字体本身已经是最粗的一档，描边只负责和底色分开
    l.outlineWidth = o.outlineWidth !== undefined ? Math.round(o.outlineWidth * k) : Math.max(2, Math.round(fontSize / OUTLINE_DIV));
  }
  // 描边字下面压一道更深的硬投影，字像有厚度一样立起来；小字不加，免得糊
  if (o.shadow ?? (!!outline && design >= 28)) {
    l.enableShadow = true;
    l.shadowColor = depthColor(outline ?? COLOR.shadow);
    l.shadowOffset.set(0, -Math.max(1, Math.round(fontSize / SHADOW_DIV)));
    l.shadowBlur = 1;
  } else if (!outline && ink.depth && o.shadow !== false) {
    // 平面按钮上的字：不描边，只在下面压一道实色
    l.enableShadow = true;
    l.shadowColor = ink.depth;
    l.shadowOffset.set(0, -Math.max(2, Math.round(fontSize / FLAT_DEPTH_DIV)));
    l.shadowBlur = 0;
  }
  l.horizontalAlign =
    o.align === 'left' ? HorizontalTextAlignment.LEFT : o.align === 'right' ? HorizontalTextAlignment.RIGHT : HorizontalTextAlignment.CENTER;
  l.verticalAlign = VerticalTextAlignment.CENTER;
  if (o.width !== undefined) {
    l.overflow = Label.Overflow.RESIZE_HEIGHT;
    l.enableWrapText = true;
    size(n, o.width * k, l.lineHeight);
  }
  if (o.align === 'left') (n.getComponent(UITransform) as UITransform).setAnchorPoint(0, 0.5);
  if (o.align === 'right') (n.getComponent(UITransform) as UITransform).setAnchorPoint(1, 0.5);
  l.string = s;
  if (k !== 1) n.setScale(1 / k, 1 / k, 1);
  return l;
}

/** 这行字现在有多宽（设计单位） */
export function textWidth(l: Label): number {
  l.updateRenderData(true);
  return (l.node.getComponent(UITransform) as UITransform).width * Math.abs(l.node.scale.x);
}

/**
 * 一行字最宽 maxW：超了就把字号缩到刚好放下（最小 min）。别的语言字长、数字位数多时不压到旁边的东西。
 * 内容会变的字（数量、倒计时）每次改完再调一次，base 传原来的字号
 */
export function fit(l: Label, maxW: number, base = l.fontSize, min = 20): void {
  l.fontSize = base;
  const w = textWidth(l);
  if (w <= maxW) return;
  l.fontSize = Math.max(min, Math.floor((base * maxW) / w));
  l.updateRenderData(true);
  // 调试构建：记下每次缩字（文字不缩放，太长就精简文字）。检查工具和控制台 gsDebug.fitLog 能看到
  if (DEBUG) fitLog.push({ text: l.string, base, size: l.fontSize, need: Math.round(w), room: Math.round(maxW) });
}

/** 调试构建里每次 fit 缩了字的记录（文字、原字号、缩到几号、需要多宽、能放多宽） */
export const fitLog: { text: string; base: number; size: number; need: number; room: number }[] = [];

/** 一行里左边标题、右边小字状态，一共 room 宽：右边最多占一半，剩下的给左边，中间至少留 gap */
export function fitPair(left: Label, right: Label, room: number, leftBase: number, rightBase: number, gap = 14): void {
  fit(right, room * 0.5, rightBase);
  fit(left, room - textWidth(right) - gap, leftBase);
}

/**
 * 页标题牌（各页统一：同一块牌、同一个高度和字号，牌的宽度跟着字走）。
 * h 默认 80；夹在顶栏和内容之间的（商店）给小一点
 */
/** 立体牌（标题牌、入口标签）上的字往上提多少（占牌高）：牌的正面比外框高半道下边（0.06），
 * 对准正面中心看着偏上（字没上下居中），取正面中心和外框中心的中间 */
export const PLATE_TEXT_LIFT = 0.03;

/** 页面标题牌：宽度随字（两边各留 padK/2 个牌高），最窄 minW、最宽 maxW（字太长就缩小） */
export function pageTitle(parent: Node, s: string, h = 80, maxW = 630, minW = 220, padK = 1.4): Node {
  const n = plate(parent, 'skin/f_plate_blue', 240, h, 'title');
  const l = text(n, s, Math.round(h * 0.56));
  l.node.setPosition(0, h * PLATE_TEXT_LIFT, 0);
  const pad = Math.round(h * padK);
  fit(l, Math.min(520, maxW - pad));
  resizePlate(n, Math.max(minW, Math.min(maxW, Math.round(textWidth(l) + pad))), h);
  return n;
}

/** 字的厚度色：比描边再深一档 */
function depthColor(c: Color): Color {
  return new Color(Math.round(c.r * 0.7), Math.round(c.g * 0.7), Math.round(c.b * 0.7), 235);
}

function inkColor(ink: Ink, c?: Color): Color {
  if (!c || c.equals(COLOR.white)) return ink.text;
  if (c.equals(COLOR.yellow)) return ink.accent;
  return c;
}

/** 文字、图标按新的面重新取色（按钮换颜色时用） */
export function reink(n: Node): void {
  const ink = inkOf(n);
  const walk = (m: Node) => {
    if (m !== n && inks.has(m)) return;
    const l = m.getComponent(Label);
    if (l) {
      l.color = ink.text;
      l.enableOutline = !!ink.outline;
      if (ink.outline) {
        l.outlineColor = ink.outline;
        if (l.enableShadow) l.shadowColor = depthColor(ink.outline);
      } else if (ink.depth && l.enableShadow) {
        l.shadowColor = ink.depth;
      }
    }
    const sp = m.getComponent(Sprite);
    if (sp && glyphs.has(m)) sp.color = ink.glyph ?? COLOR.white;
    m.children.forEach(walk);
  };
  n.children.forEach(walk);
}

export function opacity(n: Node): UIOpacity {
  return n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
}

export function blockInput(n: Node): void {
  if (!n.getComponent(BlockInputEvents)) n.addComponent(BlockInputEvents);
}

// ---------------------------------------------------------------- 点击

export interface TapOpts {
  /** 按下缩到多少，0 = 不缩 */
  press?: number;
  /** 按下时的音效名；null = 不响 */
  sound?: string | null;
  /** 按下 / 松开时调（按钮换「按下」的皮、字下沉） */
  onPress?: (down: boolean) => void;
}

let onTapSound: (name: string) => void = () => {};
export function setTapSound(f: (name: string) => void): void {
  onTapSound = f;
}

/** 按下到松开移动超过这么多（设计单位）就不算点 */
export const TAP_SLOP = 14;

/** 点击：按下缩 0.95，松手回弹（docs/09）。手指滑出节点再松开不算 */
export function onTap(n: Node, fn: (e: EventTouch) => void, o: TapOpts = {}): void {
  const press = o.press ?? 0.95;
  let base = n.scale.clone();
  let down = false;
  n.on(Node.EventType.TOUCH_START, () => {
    down = true;
    o.onPress?.(true);
    if (press > 0) {
      Tween.stopAllByTarget(n);
      base = base.x === 0 ? new Vec3(1, 1, 1) : base;
      tween(n).to(0.06, { scale: new Vec3(base.x * press, base.y * press, 1) }).start();
    }
  });
  const release = (fire: boolean, e?: EventTouch) => {
    if (!down) return;
    down = false;
    o.onPress?.(false);
    // 手指滑动过（在滚动列表里拖）就不算点
    if (e && Vec2.distance(e.getUILocation(), e.getUIStartLocation()) > TAP_SLOP) fire = false;
    if (press > 0) {
      Tween.stopAllByTarget(n);
      tween(n)
        .to(0.08, { scale: new Vec3(base.x * 1.04, base.y * 1.04, 1) })
        .to(0.08, { scale: base })
        .start();
    }
    if (fire && e) {
      if (o.sound !== null) onTapSound(o.sound ?? 'tap');
      fn(e);
    }
  };
  n.on(Node.EventType.TOUCH_END, (e: EventTouch) => release(true, e));
  n.on(Node.EventType.TOUCH_CANCEL, () => release(false));
}

// ---------------------------------------------------------------- 按钮

/**
 * 按钮颜色按语义固定（docs/09）：green 主行动 · blue 次行动（白底蓝字）· yellow 奖励 / 广告（琥珀）·
 * red 危险 · gray 不可用。一屏只有一个主按钮
 */
export type BtnColor = 'green' | 'blue' | 'yellow' | 'red' | 'gray';


const BTN_SKIN: Record<BtnColor, string> = {
  green: 'skin/j_btn_green',
  blue: 'skin/j_btn_blue',
  yellow: 'skin/j_btn_amber',
  red: 'skin/j_btn_red',
  gray: 'skin/j_btn_gray',
};
/** 按下时皮压暗到这个颜色 */
const PRESSED = new Color(205, 205, 205, 255);

export interface BtnOpts {
  color: BtnColor;
  w: number;
  h: number;
  label?: string;
  fontSize?: number;
  /** 文字前的小图标（视频、金币…） */
  icon?: string;
  iconSize?: number;
  /** 用一张艺术字图代替文字（主按钮「开始」；只在有对应语言的图时给）。label 仍然要给，读屏和回退用 */
  art?: { path: string; w: number; h: number };
  onTap?: () => void;
}

export interface Btn {
  node: Node;
  label: Label | null;
  icon: Node | null;
  setLabel(s: string): void;
  setColor(c: BtnColor): void;
  /** 灰掉：还能点（点了给反馈），但看起来不可用 */
  setEnabled(on: boolean): void;
  enabled: boolean;
}

/** 平面按钮：纯色圆角方块 + 底下一道同色系的粗边；按下整体缩一点并压暗 */
export function button(parent: Node | null, o: BtnOpts): Btn {
  const n = plate(parent, BTN_SKIN[o.color], o.w, o.h, 'button');
  const fs = o.fontSize ?? Math.round(o.h * 0.4);
  let color = o.color;
  let pressed = false;
  const row = box('row', n);
  // 面的中心比外框中心高半道下边（下边占按钮高的 11%，见 tools/art/flat_skin.py）
  const place = () => row.setPosition(0, o.h * 0.055 - (pressed ? 2 : 0), 0);
  place();
  let icon: Node | null = null;
  if (o.icon) {
    const is = o.iconSize ?? Math.round(o.h * 0.5);
    icon = img(row, o.icon, is, is, 'icon');
  }
  // 按钮字按 2 倍渲染再缩回去：高分屏上不糊（见 TextOpts.sharp）
  const label = o.label !== undefined ? text(row, o.label, fs, { sharp: 2 }) : null;
  const art = o.art ? img(row, o.art.path, o.art.w, o.art.h, 'art') : null;
  if (art && label) label.node.active = false;
  const layout = () => {
    const gap = 10;
    const ic = icon && icon.active ? icon : null;
    const iw = ic ? sizeOf(ic).w : 0;
    // 字比按钮宽（别的语言字长）就缩小字号，两边各留 20，不伸到按钮外面
    if (label && !art) fit(label, (o.w - 40 - (ic ? iw + gap : 0)) / label.node.scale.x, fs * 2, 28);
    const lw = art ? sizeOf(art).w : label ? (label.node.getComponent(UITransform) as UITransform).width * label.node.scale.x : 0;
    const total = iw + (ic && label ? gap : 0) + lw;
    let x = -total / 2;
    if (ic) {
      ic.setPosition(x + iw / 2, 0, 0);
      x += iw + gap;
    }
    if (label) label.node.setPosition(x + lw / 2, 0, 0);
    if (art) art.setPosition(x + lw / 2, 0, 0);
  };
  if (label) label.updateRenderData(true);
  layout();
  const skin = () => {
    const c = b.enabled ? color : 'gray';
    setPlate(n, BTN_SKIN[c]);
    const sp = n.getChildByName('skin')?.getComponent(Sprite);
    if (sp) sp.color = pressed ? PRESSED : COLOR.white;
    const k = PART_INK[BTN_SKIN[c]];
    if (k && inks.get(n) !== k) {
      inks.set(n, k);
      reink(n);
    }
  };
  const b: Btn = {
    node: n,
    label,
    icon,
    enabled: true,
    setLabel(s: string) {
      if (!label) return;
      label.string = s;
      label.updateRenderData(true);
      layout();
    },
    setColor(c: BtnColor) {
      color = c;
      skin();
    },
    setEnabled(on: boolean) {
      b.enabled = on;
      skin();
    },
  };
  const press = (down: boolean) => {
    pressed = down;
    place();
    skin();
  };
  if (o.onTap) {
    const fn = o.onTap;
    onTap(n, () => fn(), { press: 0.96, onPress: press });
  }
  return b;
}

/** 次按钮里放两行字：上面主文字（可带图标），下面小字（可带图标）。都放在按钮的 row 里，按下时一起下沉 */
export function twoLines(b: Btn, main: string, sub: string, subIcon: string | null, mainIcon: string | null = null): void {
  const row = b.node.getChildByName('row') as Node;
  const top = box('l1', row);
  at(top, 0, 15);
  const parts1: Node[] = [];
  if (mainIcon) parts1.push(img(top, mainIcon, 40, 40, 'ic'));
  parts1.push(text(top, main, 34).node);
  const bot = box('l2', row);
  at(bot, 0, -22);
  const parts2: Node[] = [];
  if (subIcon) parts2.push(img(bot, subIcon, 28, 28, 'ic'));
  parts2.push(text(bot, sub, 26).node);
  for (const parts of [parts1, parts2]) {
    const ws = parts.map((n) => {
      const l = n.getComponent(Label);
      if (l) l.updateRenderData(true);
      return (n.getComponent(UITransform) as UITransform).width;
    });
    const total = ws.reduce((x, y) => x + y, 0) + 6 * (ws.length - 1);
    let x = -total / 2;
    parts.forEach((n, i) => {
      at(n, x + ws[i] / 2, 0);
      x += ws[i] + 6;
    });
  }
}

/** 图标键（设置、加号、返回、关闭）：纯色圆角方块 + 底下一道粗边 + 白色图标；按下缩一点并压暗。fn 为 null 时只是个摆设（外面整块可点） */
export function keyButton(parent: Node, color: 'blue' | 'green' | 'red', glyph: string, s: number, fn: (() => void) | null, glyphScale = 0.56): Node {
  const n = img(parent, `skin/f_key_${color}`, s, s, 'key');
  const g = img(n, glyph, s * glyphScale, s * glyphScale, 'glyph');
  // 面的中心比外框高半道下边
  g.setPosition(0, s * 0.055, 0);
  const sp = n.getComponent(Sprite) as Sprite;
  if (fn) onTap(n, () => fn(), { press: 0.92, onPress: (down) => (sp.color = down ? PRESSED : COLOR.white) });
  return n;
}

/** 蓝色图标键（设置、返回）。skin 参数是旧接口，留着不用 */
export function iconButton(parent: Node, _skin: string, glyph: string | null, s: number, fn: () => void): Node {
  return keyButton(parent, 'blue', glyph ?? 'kit/ic_gear', s, fn);
}

/** 信息条（金币、生命、关卡号）：白色圆角小条，左边图标 + 深蓝数字 */
export interface Capsule {
  node: Node;
  label: Label;
  icon: Node | null;
  set(s: string): void;
}

/**
 * widest：给了就按这串字（最长会写成什么样）定宽，w 不用；条的宽度贴着内容，右边不空一大截（宽度自适应）
 */
export function capsule(parent: Node, w: number, h: number, iconPath: string | null, s: string, fontSize = Math.round(h * 0.56), skin = 'skin/f_dock', widest?: string): Capsule {
  const n = plate(parent, skin, w, h, 'capsule');
  // 有图标：数字左对齐紧跟图标；没图标：居中
  const lead = iconPath ? h * 0.96 + 8 : 0;
  const label = text(n, widest ?? s, fontSize, iconPath ? { align: 'left' } : {});
  if (widest !== undefined) {
    w = Math.round(lead + textWidth(label) + (iconPath ? h * 0.45 : h * 0.9));
    resizePlate(n, w, h);
  }
  let icon: Node | null = null;
  if (iconPath) {
    icon = img(n, iconPath, h * 0.92, h * 0.92, 'icon');
    icon.setPosition(-w / 2 + h * 0.5, 0, 0);
  }
  label.node.setPosition(iconPath ? -w / 2 + lead : 0, 0, 0);
  const room = w - lead - (widest !== undefined ? h * 0.3 : 24);
  const set = (v: string) => {
    label.string = v;
    fit(label, room, fontSize);
  };
  set(s);
  return { node: n, label, icon, set };
}

// ---------------------------------------------------------------- 进度条

export interface Bar {
  node: Node;
  set(frac: number): void;
}

/** 进度条：底槽 + 从左往右长的填充（填充最短也有一个高度宽，圆头不变形） */
export function progressBar(parent: Node, w: number, h: number, color: 'green' | 'yellow' | 'blue' = 'green'): Bar {
  // 浅色卡片上用浅蓝凹槽，深色底上用深色半透明槽
  const track = slice(parent, inkOf(parent) === ON_LIGHT ? 'kit/bar_track_light' : 'kit/bar_track', w, h, 'bar');
  const fill = slice(track, `kit/bar_${color}`, w, h, 'fill');
  const set = (frac: number) => {
    const f = Math.max(0, Math.min(1, frac));
    fill.active = f > 0;
    const fw = Math.max(h, w * f);
    resizeSlice(fill, fw, h);
    fill.setPosition(-w / 2 + fw / 2, 0, 0);
  };
  set(0);
  return { node: track, set };
}

/**
 * Codex 画的艺术数字（连击用）：'0'-'9' 和 '×'，金色糖果字。h = 数字高度；返回整行的宽。
 * 内容变了就清空重排（字数很少）
 */
export function artNumber(n: Node, s: string, h: number, align: 'left' | 'center' = 'center'): number {
  n.destroyAllChildren();
  const k = h / 180;
  const parts: [Node, number][] = [];
  for (const ch of s) {
    const path = ch === '×' ? 'skin/j_dg_x' : /[0-9]/.test(ch) ? `skin/j_dg_${ch}` : null;
    if (!path) continue;
    const f = frame(path);
    if (!f) continue;
    const g = img(n, path, f.originalSize.width * k, f.originalSize.height * k, 'g');
    parts.push([g, f.originalSize.width * k]);
  }
  const gap = -h * 0.07;
  const total = parts.reduce((a, [, w]) => a + w, 0) + gap * Math.max(0, parts.length - 1);
  let x = align === 'left' ? 0 : -total / 2;
  for (const [g, w] of parts) {
    at(g, x + w / 2, 0);
    x += w + gap;
  }
  return total;
}

/** 红点（右上角），可脉动 */
export function redDot(parent: Node, x: number, y: number, s = 30): Node {
  const n = img(parent, 'kit/dot_red', s, s, 'redDot');
  n.setPosition(x, y, 0);
  return n;
}
