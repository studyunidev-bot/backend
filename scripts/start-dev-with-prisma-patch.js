const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const prismaClientCandidates = [
  path.join(projectRoot, 'node_modules', '@prisma', 'client'),
  path.join(projectRoot, '.deps', 'node_modules', '@prisma', 'client'),
];
const prismaClientSource = prismaClientCandidates.find((candidate) => fs.existsSync(candidate));

if (!prismaClientSource) {
  throw new Error('Could not find @prisma/client in node_modules or .deps/node_modules');
}

const prismaNodeModulesRoot = path.dirname(path.dirname(prismaClientSource));
const nestBinary = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'nest.cmd' : 'nest',
);
const patchScript = path.join(projectRoot, 'scripts', 'patch-prisma-runtime.js');
const distMainPath = path.join(projectRoot, 'dist', 'src', 'main.js');
const prismaSymlinkTargets = [
  path.join(projectRoot, 'dist', 'node_modules', '@prisma', 'client'),
  path.join(projectRoot, 'dist', 'src', 'generated', 'prisma', 'internal', 'node_modules', '@prisma', 'client'),
];

let appProcess = null;
let isRestarting = false;
let restartRequested = false;

function ensurePrismaSymlinks() {
  for (const symlinkTarget of prismaSymlinkTargets) {
    fs.mkdirSync(path.dirname(symlinkTarget), { recursive: true });

    try {
      fs.rmSync(symlinkTarget, { recursive: true, force: true });
    } catch {}

    fs.symlinkSync(prismaClientSource, symlinkTarget, 'dir');
  }
}

function runPatchScript() {
  return new Promise((resolve, reject) => {
    const patchProcess = spawn(process.execPath, [patchScript], {
      cwd: projectRoot,
      stdio: 'inherit',
    });

    patchProcess.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`patch-prisma-runtime.js exited with code ${code}`));
    });

    patchProcess.on('error', reject);
  });
}

function stopAppProcess() {
  return new Promise((resolve) => {
    if (!appProcess) {
      resolve();
      return;
    }

    const processToStop = appProcess;
    appProcess = null;

    processToStop.once('exit', () => resolve());
    processToStop.kill('SIGTERM');
  });
}

async function restartAppProcess() {
  if (isRestarting) {
    restartRequested = true;
    return;
  }

  if (!fs.existsSync(distMainPath)) {
    return;
  }

  isRestarting = true;

  try {
    ensurePrismaSymlinks();
    await runPatchScript();
    await stopAppProcess();

    appProcess = spawn(process.execPath, [distMainPath], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_PATH: prismaNodeModulesRoot,
      },
    });

    appProcess.on('exit', () => {
      if (appProcess && appProcess.exitCode !== null) {
        appProcess = null;
      }
    });
  } catch (error) {
    console.error('[dev-watch] Failed to restart application:', error);
  } finally {
    isRestarting = false;

    if (restartRequested) {
      restartRequested = false;
      void restartAppProcess();
    }
  }
}

function wireOutput(stream, forward, onLine) {
  let buffer = '';

  stream.on('data', (chunk) => {
    const text = chunk.toString();
    forward.write(text);
    buffer += text;

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      onLine(line);
    }
  });
}

const buildProcess = spawn(nestBinary, ['build', '--watch'], {
  cwd: projectRoot,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
});

wireOutput(buildProcess.stdout, process.stdout, (line) => {
  if (line.includes('Found 0 errors.')) {
    void restartAppProcess();
  }
});
wireOutput(buildProcess.stderr, process.stderr, (line) => {
  if (line.includes('Found 0 errors.')) {
    void restartAppProcess();
  }
});

buildProcess.on('exit', async (code) => {
  await stopAppProcess();
  process.exit(code || 0);
});

buildProcess.on('error', async (error) => {
  console.error('[dev-watch] Failed to start Nest build watcher:', error);
  await stopAppProcess();
  process.exit(1);
});

async function shutdown(signal) {
  buildProcess.kill(signal);
  await stopAppProcess();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});