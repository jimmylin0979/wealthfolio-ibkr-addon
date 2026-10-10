import express from 'express';
import cors from 'cors';
import { readFileSync, statSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3001;
const ADDON_ID = 'ibkr-multi-import';
const MANIFEST_PATH = join(__dirname, 'manifest.json');
const ADDON_JS_PATH = join(__dirname, 'dist', 'addon.js');

const app = express();

// Enable CORS for development
app.use(cors());

// --- Runtime package generation tracking (Wealthfolio 3.7+ dev protocol) ---
// The host polls /status and reloads only when generation strictly increases,
// so we bump it whenever dist/addon.js changes on disk.
let generation = 1;
let lastMtimeMs = null;

const sseClients = new Set();

function broadcastAddonChanged() {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify({ type: 'addon-changed', addonId: ADDON_ID })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function refreshGeneration() {
  if (!existsSync(ADDON_JS_PATH)) return;
  const mtimeMs = statSync(ADDON_JS_PATH).mtimeMs;
  if (lastMtimeMs === null) {
    lastMtimeMs = mtimeMs;
  } else if (mtimeMs !== lastMtimeMs) {
    lastMtimeMs = mtimeMs;
    generation += 1;
    broadcastAddonChanged();
  }
}

// Detect rebuilds even when the host is not actively polling.
setInterval(() => refreshGeneration(), 1000);

// Keep SSE connections alive through proxies/idle timeouts.
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': heartbeat\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 25000);

// Health check endpoint (host discovery probes this first)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Status endpoint: host hot-reload polling reads generation/buildInProgress.
// Legacy fields (version/name) kept for any older tooling.
app.get('/status', (req, res) => {
  refreshGeneration();
  res.json({
    status: 'running',
    version: '1.0.0',
    name: ADDON_ID,
    buildInProgress: false,
    generation
  });
});

// Addon updates endpoint: SSE stream the host's EventSource listens on.
app.get('/addon-updates', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders?.();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Manifest endpoint (host discovery registers the addon from this)
app.get('/manifest.json', (req, res) => {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    res.json(manifest);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read manifest' });
  }
});

// Serve the addon bundle
app.get('/addon.js', (req, res) => {
  try {
    const addonJs = readFileSync(ADDON_JS_PATH, 'utf-8');
    res.type('application/javascript').send(addonJs);
  } catch (error) {
    res.status(404).json({ error: 'Addon bundle not found. Run `pnpm build` first.' });
  }
});

// Wealthfolio 3.7+ runtime package protocol. The host fetches this to load a
// dev addon; without it the host reports a 404 "does not support 3.7 runtime
// packages" error. The addon uses no packaged assets, so assets is empty.
app.get('/runtime-package', (req, res) => {
  try {
    refreshGeneration();
    if (!existsSync(ADDON_JS_PATH)) {
      // 409 (not 404/405) so the host surfaces this detail instead of the
      // generic "runtime packages unsupported" message.
      res.status(409).json({ error: 'Addon bundle not found. Run `pnpm build` first.' });
      return;
    }
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    const content = readFileSync(ADDON_JS_PATH, 'utf-8');
    res.set('Cache-Control', 'no-store');
    res.json({
      assets: [],
      files: [
        {
          name: 'addon.js',
          content,
          isMain: true,
          size: Buffer.byteLength(content)
        }
      ],
      generation,
      manifest
    });
  } catch (error) {
    res.status(500).json({ error: String((error && error.message) || error) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 IBKR Multi-Import addon dev server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`   Addon bundle: http://localhost:${PORT}/addon.js`);
  console.log(`   Runtime package: http://localhost:${PORT}/runtime-package`);
});
