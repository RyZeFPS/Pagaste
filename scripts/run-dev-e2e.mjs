import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const baseUrl = 'http://127.0.0.1:8081';
const expoCli = join(projectRoot, 'node_modules', 'expo', 'bin', 'cli');
const playwrightCli = join(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js');

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function responds() {
  try {
    const response = await fetch(baseUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(1_000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Expo terminó antes de servir la aplicación (código ${server.exitCode}).`);
    }
    if (await responds()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Expo no respondió en 120 segundos.');
}

async function stopServer(server) {
  if (!server.pid || server.exitCode !== null) return;
  if (process.platform === 'win32') {
    server.kill();
    await Promise.race([waitForExit(server), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    if (server.exitCode !== null) return;
    const killer = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    await waitForExit(killer).catch(() => undefined);
    await Promise.race([waitForExit(server), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    server.unref();
    return;
  }

  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    return;
  }
  await Promise.race([waitForExit(server), new Promise((resolve) => setTimeout(resolve, 3_000))]);
  if (server.exitCode === null) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      // The process group already stopped.
    }
  }
}

if (await responds()) {
  throw new Error(
    `El puerto ${new URL(baseUrl).port} ya está ocupado. Detén ese servidor y repite.`,
  );
}

const server = spawn(process.execPath, [expoCli, 'start', '--web', '--port', '8081'], {
  cwd: projectRoot,
  detached: process.platform !== 'win32',
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_local_only',
    EXPO_PUBLIC_APP_URL: baseUrl,
  },
});

let testExitCode = 1;
try {
  await waitForServer(server);
  const tests = spawn(process.execPath, [playwrightCli, 'test'], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PW_EXTERNAL_SERVER: '1' },
  });
  tests.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  tests.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  const result = await waitForExit(tests);
  tests.stdout?.destroy();
  tests.stderr?.destroy();
  testExitCode = result.code ?? 1;
} finally {
  await stopServer(server);
}

process.exitCode = testExitCode;
