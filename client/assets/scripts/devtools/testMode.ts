// 测试模式（底座，换游戏照用；docs/10 第 9 节）：上线后的正式包也能打开，方便测试。
// 设置弹窗的标题「设置」10 秒内连点 10 下（必须 10 下）打开；打开后设置里才出隐藏的按钮（难度调试页：挑题、看路线、机器人代打、作弊键；广告测试）。
// 存在本机，重开游戏还在；再连点 10 下关掉（不出任何按钮、不弹任何字）。默认关着（开发版也一样，./run.sh page lab 可以直接进调试页）。
// 调试用，字直接写、不进翻译表。
import type { PlatformBase } from '../platform/platformBase';

const KEY = 'test_mode';
/** 连点几下、几秒内 */
const TAPS = 10;
const WINDOW_MS = 10_000;

let on = false;
let platform: PlatformBase | null = null;
const taps: number[] = [];

/** 启动时读一次（Boot） */
export function init(p: PlatformBase): void {
  platform = p;
  on = p.loadData(KEY) === '1';
}

export function isOn(): boolean {
  return on;
}

export function set(v: boolean): void {
  on = v;
  platform?.saveData(KEY, v ? '1' : '');
}

/** 点了一下设置标题（now 毫秒）：10 秒内凑够 10 下返回 true（同时清零重数） */
export function tap(now: number): boolean {
  taps.push(now);
  while (taps.length > 0 && now - taps[0] > WINDOW_MS) taps.shift();
  if (taps.length < TAPS) return false;
  taps.length = 0;
  return true;
}
