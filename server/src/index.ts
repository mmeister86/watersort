import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';

import { createApp, validateAppEnv } from './app';
import { Store, probeDataDir } from './store';

const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? './data';
const familyCode = process.env.FAMILY_CODE ?? '';
const cookieSecret = process.env.COOKIE_SECRET ?? '';

// Fail closed: without both secrets the family-code gate is meaningless.
const envError = validateAppEnv({ familyCode, cookieSecret });
if (envError !== undefined) {
  console.error(`FATAL: ${envError}`);
  process.exit(1);
}

// Fail loudly when the data volume is not writable, before serving anything.
try {
  probeDataDir(dataDir);
} catch (error) {
  console.error(`FATAL: DATA_DIR "${dataDir}" is not writable:`, error);
  process.exit(1);
}

/**
 * Locates the built SPA. In the repo it lives at `web/dist`; the Docker
 * runtime copies it to `public/`. Checked relative to both the process cwd
 * and the bundle location so local runs and the container both work.
 */
function findStaticDir(): string | undefined {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const candidates = [
    resolve(process.cwd(), 'web/dist'),
    resolve(repoRoot, 'web/dist'),
    resolve(process.cwd(), 'public'),
    resolve(repoRoot, 'public'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) {
      return dir;
    }
  }
  console.warn(
    'WARNING: no built web app found (looked for web/dist and public/); serving API only.',
  );
  return undefined;
}

const staticDir = findStaticDir();
const store = new Store({ dataDir });
const app = createApp(store, {
  familyCode,
  cookieSecret,
  ...(staticDir === undefined ? {} : { staticDir }),
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});
