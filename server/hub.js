// Live updates over Server-Sent Events: one tiny JSON message per change.
// Lighter than WebSockets and passes through mobile proxies/Cloudflare.
const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;

export function createHub({ pingMs = 25000 } = {}) {
  const subs = new Map(); // shopId -> Set<res>

  // Comment pings keep 2G/mobile connections from being dropped as idle.
  const timer = setInterval(() => {
    for (const set of subs.values()) for (const res of set) res.write(': p\n\n');
  }, pingMs);
  timer.unref();

  return {
    subscribe(shopId, req, res, initial) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 5000\n\n${frame(initial)}`);
      let set = subs.get(shopId);
      if (!set) subs.set(shopId, (set = new Set()));
      set.add(res);
      req.on('close', () => {
        set.delete(res);
        if (!set.size) subs.delete(shopId);
      });
    },
    publish(shopId, data) {
      const set = subs.get(shopId);
      if (!set) return;
      const f = frame(data);
      for (const res of set) res.write(f);
    },
    listeners: (shopId) => subs.get(shopId)?.size ?? 0,
    close() {
      clearInterval(timer);
      for (const set of subs.values()) for (const res of set) res.end();
      subs.clear();
    },
  };
}
