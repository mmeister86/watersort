import { spawn } from 'node:child_process';

// Starts the API server (watch mode) and the Vite dev server together and
// shuts both down when either exits or the process is signalled.

const commands = [
  ['npm', ['run', 'dev', '-w', '@watersort/server']],
  ['npm', ['run', 'dev', '-w', '@watersort/web']],
];

const children = commands.map(([command, args]) =>
  spawn(command, args, { stdio: 'inherit', detached: true }),
);

let shuttingDown = false;
let remaining = children.length;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (child.pid !== undefined && !child.killed) {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // Process already gone.
      }
    }
  }
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`dev: process exited (code=${code}, signal=${signal})`);
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
