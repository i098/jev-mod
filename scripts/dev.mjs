import { spawn } from 'node:child_process';
const children = [
  spawn('pnpm', ['dev:web'], { stdio: 'inherit', env: process.env }),
  spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', 'wrangler.preview.jsonc', '--port', process.env.API_PORT ?? '7102'], { stdio: 'inherit', env: process.env }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) child.on('exit', code => stop(code ?? 1));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
