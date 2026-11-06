import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createComposioGateway } from './composio.ts';
import { verifyOpenRouterKey } from './compose.ts';
import { Store } from './db.ts';

// Optional local config. It's git-ignored and never committed.
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const dataDir = process.env.OS_DATA_DIR ?? join(homedir(), '.os-app');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });

/** Reads a generated secret, creating it readable only by this user on first run. */
function secretFile(name: string, create: () => string): { value: string; created: boolean } {
  const path = join(dataDir, name);
  if (existsSync(path)) return { value: readFileSync(path, 'utf8').trim(), created: false };
  const value = create();
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { value, created: true };
}

const envToken = process.env.OS_TOKEN;
if (envToken && envToken.length < 24) {
  console.error('OS_TOKEN must be at least 24 characters.');
  process.exit(1);
}
const generated = envToken ? null : secretFile('token', () => randomBytes(32).toString('base64url'));
const token = envToken ?? generated!.value;
const encryptionKey = Buffer.from(secretFile('secret.key', () => randomBytes(32).toString('base64')).value, 'base64');

const store = new Store(join(dataDir, 'os.db'), encryptionKey);
const here = dirname(fileURLToPath(import.meta.url));

const { app, scheduler } = createApp({
  store,
  token,
  env: process.env,
  createGateway: (apiKey) => createComposioGateway(apiKey, process.env.OS_COMPOSIO_USER_ID ?? 'default'),
  verifyOpenRouterKey,
  webDir: process.env.OS_WEB_DIR ?? resolve(here, '../../app/dist'),
});

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '127.0.0.1';
const server = serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(`OS server running at http://${hostname}:${port}`);
  if (generated?.created) console.log(`Your server token (shown once, also saved in ${join(dataDir, 'token')}):\n${token}`);
  else if (generated) console.log(`Server token is in ${join(dataDir, 'token')}`);
});

const shutdown = () => {
  scheduler.stop();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
