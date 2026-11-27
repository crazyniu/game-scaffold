#!/usr/bin/env node
// 录试玩页面：画布 + 游戏声音，存成 mp4（Chrome 不支持 mp4 时存 webm）。由 ./run.sh record 调用（docs/10 第 9 节）。
// 连上带 --remote-debugging-port 开的 Chrome，把页面设成手机竖屏（W×H、2 倍屏 → 默认 1080×1920），打开 URL，
// 等游戏画面出来后用 MediaRecorder 录 SECS 秒，再分块读回来写文件。只用 Node 自带的 fetch / WebSocket，不装东西。
// 环境变量：CDP_PORT（调试端口）、URL（要打开的地址）、SECS（录几秒，默认 60）、OUT（输出文件，不带扩展名）、
//           W / H（页面大小，默认 540×960）、VBR（视频码率，默认 12 Mbps）
import { writeFileSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9333);
const URL_ = process.env.URL ?? '';
const SECS = Number(process.env.SECS ?? 60);
const OUT = process.env.OUT ?? 'recording';
const W = Number(process.env.W ?? 540), H = Number(process.env.H ?? 960);
const VBR = Number(process.env.VBR ?? 12_000_000);
if (!URL_) {
  console.error('没给 URL');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome 刚开时调试端口可能还没起来：最多等 15 秒
let pages = null;
for (let i = 0; i < 30 && !pages; i++) {
  try {
    pages = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((p) => p.type === 'page');
    if (!pages.length) pages = null;
  } catch {
    /* 还没起来 */
  }
  if (!pages) await sleep(500);
}
if (!pages) {
  console.error(`连不上 Chrome 的调试端口 ${PORT}`);
  process.exit(1);
}
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
let id = 0;
const waiting = new Map();
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id;
    waiting.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waiting.has(d.id)) {
    waiting.get(d.id)(d.result ?? { error: d.error });
    waiting.delete(d.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const ev = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (r.exceptionDetails || r.error) console.error('页面里出错：', JSON.stringify(r.exceptionDetails ?? r.error).slice(0, 400));
  return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
// 页面脚本运行前：凡是接到扬声器的音频节点，同时接一份到录音出口（游戏声音直接录进去，不经过麦克风）
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
  const orig = AudioNode.prototype.connect;
  window.__recCtxs = [];
  AudioNode.prototype.connect = function (dest, ...a) {
    const r = orig.call(this, dest, ...a);
    try {
      if (dest instanceof AudioDestinationNode) {
        const ctx = dest.context;
        if (!ctx.__recDest) { ctx.__recDest = ctx.createMediaStreamDestination(); window.__recCtxs.push(ctx); }
        orig.call(this, ctx.__recDest);
      }
    } catch (e) {}
    return r;
  };
})();`,
});
console.log('→ 打开', URL_);
await send('Page.navigate', { url: URL_ });

// 等画布和声音都出来（最多 40 秒），再多等 2 秒让载入画面过去
for (let i = 0; i < 80; i++) {
  if (await ev(`!!document.querySelector('canvas') && (window.__recCtxs||[]).length > 0`)) break;
  await sleep(500);
}
await sleep(2000);
await ev(`Promise.all((window.__recCtxs||[]).map(c => c.resume()))`, true);
const info = await ev(`(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const tracks = [...c.captureStream(30).getVideoTracks()];
  const ctx = (window.__recCtxs||[])[0];
  if (ctx) tracks.push(...ctx.__recDest.stream.getAudioTracks());
  const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: ${VBR}, audioBitsPerSecond: 192000 });
  window.__chunks = []; window.__rec = rec;
  rec.ondataavailable = (e) => e.data.size && window.__chunks.push(e.data);
  rec.start(1000);
  return { mime, w: c.width, h: c.height, audio: tracks.length > 1 };
})()`);
if (!info) {
  console.error('页面上没有游戏画布，没录');
  process.exit(1);
}
console.log(`→ 开始录：${info.w}×${info.h}，${info.audio ? '带' : '没有'}声音，${SECS} 秒`);
for (let t = 0; t < SECS; t += 10) {
  await sleep(Math.min(10, SECS - t) * 1000);
  if (t + 10 < SECS) console.log(`  ${t + 10} 秒`);
}
const size = await ev(
  `new Promise(res => { window.__rec.onstop = async () => { const b = new Blob(window.__chunks, { type: window.__rec.mimeType }); window.__buf = new Uint8Array(await b.arrayBuffer()); res(window.__buf.length); }; window.__rec.stop(); })`,
  true,
);
// 分块（每块 3 MB）转 base64 读回来，一次读整段会超过调试协议的消息上限
const parts = [];
const STEP = 3 << 20;
for (let off = 0; off < size; off += STEP) {
  const b64 = await ev(
    `(() => { const u = window.__buf.subarray(${off}, ${off + STEP}); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); })()`,
  );
  parts.push(Buffer.from(b64, 'base64'));
}
const file = `${OUT}.${info.mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
writeFileSync(file, Buffer.concat(parts));
console.log(`→ 存好了：${file}（${(size / 1048576).toFixed(1)} MB）`);
await ev(`window.__buf = null; window.__chunks = null;`);
ws.close();
