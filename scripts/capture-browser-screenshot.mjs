import fs from 'node:fs/promises';

const cdpListUrl = process.env.CDP_LIST_URL || 'http://127.0.0.1:9223/json/list';
const outputPath = process.argv[2];
const width = Number(process.argv[3] || 1440);
const height = Number(process.argv[4] || 1100);
const targetUrl = process.argv[5];

if (!outputPath) throw new Error('Usage: node scripts/capture-browser-screenshot.mjs <output.png> [width] [height]');

const pages = await fetch(cdpListUrl).then(response => response.json());
const page = pages.find(candidate => candidate.type === 'page');
if (!page) throw new Error('Browser page not found');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let sequence = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const listener = event => {
    const message = JSON.parse(event.data);
    if (message.id !== id) return;
    socket.removeEventListener('message', listener);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  };
  socket.addEventListener('message', listener);
  socket.send(JSON.stringify({ id, method, params }));
});

await call('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width <= 680
});
if (targetUrl) {
  await call('Page.navigate', { url: targetUrl });
  await new Promise(resolve => setTimeout(resolve, 700));
}
await call('Runtime.evaluate', { expression: 'scrollTo(0, 0)' });
const { data } = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
await fs.writeFile(outputPath, Buffer.from(data, 'base64'));
socket.close();
console.log(JSON.stringify({ outputPath, width, height }));
