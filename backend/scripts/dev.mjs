// Hot-reload dev runner: node --watch restarts the process, ts-node/register compiles TS on the fly.
// --watch-path scopes the watcher to src/ only — without it, node --watch watches the whole
// backend/ tree, including data/*.db-wal and *.db-shm, which SQLite rewrites on every query in
// WAL mode. That turned every write into a restart, i.e. an infinite restart loop under load.
import { spawn } from 'node:child_process';

const child = spawn(
  process.execPath,
  ['--watch-path=src', '--enable-source-maps', '-r', 'ts-node/register', 'src/main.ts'],
  { stdio: 'inherit', env: process.env },
);
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
