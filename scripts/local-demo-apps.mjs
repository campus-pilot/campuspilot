/** Keep this checkout's local app processes alive across terminal closure. */
import { spawn, execFileSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Run with Node 24 or newer.');
const root = fileURLToPath(new URL('../', import.meta.url));
const local = resolve(root, 'tmp/local-demo');
await mkdir(local, { recursive: true });
const statePath = resolve(local, 'app-processes.json');
let state = {};
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const apps = [
  { name: 'server', port: 3100, module: 'apps/server/node_modules/tsx/dist/cli.mjs', args: ['watch', 'src/index.ts'] },
  { name: 'management', port: 3102, module: 'apps/management/node_modules/next/dist/bin/next', args: ['dev', '--port', '3102', '--hostname', '127.0.0.1'] },
  { name: 'admin', port: 3103, module: 'apps/admin/node_modules/next/dist/bin/next', args: ['dev', '--port', '3103', '--hostname', '127.0.0.1'] },
  { name: 'assistant', port: 3104, module: 'apps/assistant/node_modules/tsx/dist/cli.mjs', args: ['watch', 'src/index.ts'] },
];

/** Check both PID and command before treating a process group as ours. */
function isOwned(app) {
  const saved = state[app.name];
  if (!saved || saved.root !== root) return false;
  try {
    const command = execFileSync('ps', ['-p', String(saved.pid), '-o', 'command='], { encoding: 'utf8' });
    return command.includes(resolve(root, app.module));
  } catch { return false; }
}
async function portInUse(port) {
  return await new Promise((done) => {
    const connection = createConnection({ host: '127.0.0.1', port });
    connection.once('connect', () => { connection.destroy(); done(true); });
    connection.once('error', () => done(false));
  });
}

const action = process.argv[2] ?? 'status';
if (!['start', 'stop', 'status'].includes(action)) throw new Error('Use start, stop, or status.');
const requestedApps = process.argv.slice(3);
if (requestedApps.some((name) => !apps.some((app) => app.name === name))) throw new Error('Unknown app; use server, management, admin, or assistant.');
for (const app of apps.filter((app) => requestedApps.length === 0 || requestedApps.includes(app.name))) {
  const owned = isOwned(app);
  if (action === 'stop' && owned) {
    process.kill(-state[app.name].pid, 'SIGTERM');
    delete state[app.name];
    console.log(`${app.name}: stopped`);
  } else if (action === 'start' && !owned) {
    if (await portInUse(app.port)) throw new Error(`Port ${app.port} is occupied by a process this launcher does not own.`);
    const log = openSync(resolve(local, `${app.name}.log`), 'a');
    const child = spawn(process.execPath, [resolve(root, app.module), ...app.args], {
      cwd: resolve(root, 'apps', app.name), detached: true, stdio: ['ignore', log, log],
    });
    child.unref();
    closeSync(log);
    state[app.name] = { pid: child.pid, root };
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
    console.log(`${app.name}: started at http://localhost:${app.port}`);
  } else console.log(`${app.name}: ${owned ? 'running' : 'stopped'} (port ${app.port})`);
}
await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
