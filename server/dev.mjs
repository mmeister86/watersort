import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Dev server: bundle `src/index.ts` with Vite (so the `@shared` alias is
// inlined exactly as in the production build) and run the bundle with Node.
// Vite rebuilds on change, Node's watcher restarts on the new bundle.

const serverDir = fileURLToPath(new URL('.', import.meta.url));
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const distEntry = fileURLToPath(new URL('./dist/index.js', import.meta.url));

// Build once up front so the watched entry file exists before Node starts.
const initialBuild = spawnSync(process.execPath, [viteBin, 'build'], {
  cwd: serverDir,
  stdio: 'inherit',
});

if (initialBuild.status !== 0) {
  process.exit(initialBuild.status ?? 1);
}

// Dev-only convenience: the server validates that both secrets are set and
// exits otherwise. Bare `npm run dev` has no .env, so fill in throwaway
// defaults only when the developer left the variable unset. An explicitly set
// (even empty) value is passed through untouched, and the production entry
// point (`node dist/index.js`) never goes through this file, so it stays
// fail-closed.
const serverEnv = {
  ...process.env,
  FAMILY_CODE: process.env.FAMILY_CODE ?? 'dev',
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? 'dev-secret',
};

const children = [
  spawn(process.execPath, [viteBin, 'build', '--watch'], {
    cwd: serverDir,
    stdio: 'inherit',
    env: serverEnv,
  }),
  spawn(process.execPath, ['--watch', distEntry], {
    cwd: serverDir,
    stdio: 'inherit',
    env: serverEnv,
  }),
];

let shuttingDown = false;
let remaining = children.length;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (child.pid !== undefined && !child.killed && child.exitCode === null) {
      child.kill(signal);
    }
  }
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`server dev: process exited (code=${code}, signal=${signal})`);
      shutdown('SIGTERM');
      if (code !== null && code !== 0) {
        process.exitCode = code;
      }
    }
    remaining -= 1;
    if (remaining === 0) {
      process.exit(process.exitCode ?? 0);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
