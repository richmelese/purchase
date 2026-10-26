// Runs the whole app locally: the NestJS API (private, 127.0.0.1:5000) and the Next.js
// backend-for-frontend + UI (http://localhost:3000). Ctrl+C stops both.
//
//   node scripts/run.mjs dev     hot reload for both
//   node scripts/run.mjs start   production builds (run `npm run build` first)
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDir = path.join(root, 'frontend');
const backendDir = path.join(root, 'backend');
const mode = process.argv[2] === 'start' ? 'start' : 'dev';

const apiPort = process.env.API_PORT || '5000';
const env = {
  ...process.env,
  // Only the BFF knows this secret, so the API rejects anything that bypasses the frontend server.
  BFF_SHARED_SECRET: process.env.BFF_SHARED_SECRET || crypto.randomBytes(24).toString('hex'),
  BACKEND_URL: process.env.BACKEND_URL || `http://127.0.0.1:${apiPort}`,
};

if (mode === 'start') {
  for (const [dir, what] of [[path.join(frontendDir, '.next'), 'frontend'], [path.join(backendDir, 'dist'), 'backend']]) {
    if (!fs.existsSync(dir)) { console.error(`The ${what} is not built yet. Run "npm run build" first.`); process.exit(1); }
  }
}

const nextBin = path.join(frontendDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || '3000';
const children = [
  ['api', spawn(process.execPath, mode === 'dev' ? ['scripts/dev.mjs'] : ['dist/main.js'], {
    cwd: backendDir, stdio: 'inherit', env: { ...env, PORT: apiPort, HOST: '127.0.0.1' },
  })],
  ['web', spawn(process.execPath, [nextBin, mode, '-H', host, '-p', port], { cwd: frontendDir, stdio: 'inherit', env })],
];

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const [, child] of children) child.kill();
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const [name, child] of children) {
  child.on('exit', (code) => { if (!stopping) { console.error(`[${name}] exited with code ${code}; stopping.`); stop(code || 1); } });
}
