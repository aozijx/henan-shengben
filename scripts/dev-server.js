import { createReadStream, watch } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8765);
const allowedRoots = new Set(['css', 'js', 'metadata', 'data']);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};
const liveClients = new Set();
const liveReloadScript = `<script>
  (() => {
    const stream = new EventSource('/__dev/events');
    stream.addEventListener('change', (event) => {
      const change = JSON.parse(event.data);
      if (change.type === 'css') {
        const link = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
          .find((item) => new URL(item.href).pathname === change.path);
        if (link) {
          const url = new URL(link.href);
          url.searchParams.set('__dev', String(Date.now()));
          link.href = url.href;
          return;
        }
      }
      window.location.reload();
    });
  })();
</script>`;

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(message);
}

function isInsideRoot(filePath) {
  const relative = path.relative(root, filePath);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function openLiveEvents(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  response.write(': connected\n\n');
  liveClients.add(response);
  response.on('close', () => liveClients.delete(response));
}

let pendingChanges = new Set();
let changeTimer = null;

function scheduleChange(filePath) {
  pendingChanges.add(filePath);
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    const changes = Array.from(pendingChanges);
    pendingChanges = new Set();
    const change = changes.length === 1 && changes[0].endsWith('.css')
      ? { type: 'css', path: '/' + changes[0].replaceAll(path.sep, '/') }
      : { type: 'reload' };
    const payload = `event: change\ndata: ${JSON.stringify(change)}\n\n`;
    for (const client of liveClients) client.write(payload);
    console.log(change.type === 'css' ? `样式已热更新：${change.path}` : '文件已更新：浏览器正在刷新');
  }, 180);
}

function watchForChanges() {
  watch(path.join(root, 'index.html'), () => scheduleChange('index.html'));
  for (const directory of ['css', 'js', 'metadata', 'data']) {
    watch(path.join(root, directory), { recursive: true }, (eventType, filename) => {
      if (!filename) {
        scheduleChange(directory);
        return;
      }
      const relative = String(filename).replaceAll('\\', '/');
      const segments = relative.split('/');
      if (segments.some((segment) => !segment || segment.startsWith('.'))) return;
      const extension = path.extname(relative).toLowerCase();
      if (mimeTypes[extension]) scheduleChange(path.join(directory, relative));
    });
  }
}

async function serve(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method not allowed');
    return;
  }

  let segments;
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__dev/events') {
      openLiveEvents(response);
      return;
    }
    segments = pathname.replace(/^\/+/, '').split(/[\\/]/).filter(Boolean);
  } catch {
    sendText(response, 400, 'Bad request');
    return;
  }

  if (!segments.length) segments = ['index.html'];
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    sendText(response, 404, 'Not found');
    return;
  }
  if (segments[0] !== 'index.html' && !allowedRoots.has(segments[0])) {
    sendText(response, 404, 'Not found');
    return;
  }

  const extension = path.extname(segments.at(-1)).toLowerCase();
  if (!mimeTypes[extension]) {
    sendText(response, 404, 'Not found');
    return;
  }

  try {
    const requestedPath = path.resolve(root, ...segments);
    const filePath = await realpath(requestedPath);
    if (!isInsideRoot(filePath)) {
      sendText(response, 404, 'Not found');
      return;
    }
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }

    const html = segments.length === 1 && segments[0] === 'index.html';
    const body = html ? Buffer.from((await readFile(filePath, 'utf8')).replace(/<\/body>/i, `${liveReloadScript}\n</body>`)) : null;
    response.writeHead(200, {
      'Content-Type': mimeTypes[extension],
      'Content-Length': body ? body.length : fileInfo.size,
      'Cache-Control': 'no-cache'
    });
    if (request.method === 'HEAD') response.end();
    else if (body) response.end(body);
    else createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error && error.code === 'ENOENT') sendText(response, 404, 'Not found');
    else sendText(response, 500, 'Unable to read file');
  }
}

const server = createServer((request, response) => {
  serve(request, response).catch(() => sendText(response, 500, 'Unable to serve file'));
});

server.listen(port, host, () => {
  console.log(`河南专升本查询页面已启动：`);
  console.log(`  本机： http://127.0.0.1:${port}/#query`);
  Object.values(os.networkInterfaces()).flat().filter((entry) => entry && entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address))
    .forEach((entry) => console.log(`  局域网：http://${entry.address}:${port}/#query`));
  watchForChanges();
  console.log('CSS 即时热替换；HTML、JS、数据或 metadata 改动会自动刷新页面。');
  console.log('按 Ctrl+C 停止服务。');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`端口 ${port} 已被占用；可用 PORT=8766 npm run dev 更换端口。`);
  else console.error(error);
  process.exitCode = 1;
});
