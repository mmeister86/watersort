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

const children = [
  spawn(process.execPath, [viteBin, 'build', '--watch'], {
    cwd: serverDir,
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['--watch', distEntry], {
    cwd: serverDir,
    stdio: 'inherit',
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
