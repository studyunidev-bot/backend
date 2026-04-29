const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const patchScript = path.join(projectRoot, 'scripts', 'patch-prisma-runtime.js');
const distMainPath = path.join(projectRoot, 'dist', 'src', 'main.js');
const prismaClientCandidates = [
  path.join(projectRoot, 'node_modules', '@prisma', 'client'),
  path.join(projectRoot, '.deps', 'node_modules', '@prisma', 'client'),
];
const prismaClientSource = prismaClientCandidates.find((candidate) => fs.existsSync(candidate));

if (!prismaClientSource) {
  throw new Error('Could not find @prisma/client in node_modules or .deps/node_modules');
}

const prismaNodeModulesRoot = path.dirname(path.dirname(prismaClientSource));
const prismaSymlinkTargets = [
  path.join(projectRoot, 'dist', 'node_modules', '@prisma', 'client'),
  path.join(projectRoot, 'dist', 'src', 'generated', 'prisma', 'internal', 'node_modules', '@prisma', 'client'),
];

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

async function main() {
  if (!fs.existsSync(distMainPath)) {
    throw new Error('dist/src/main.js was not found. Run npm run build first.');
  }

  ensurePrismaSymlinks();
  await runPatchScript();

  const appProcess = spawn(process.execPath, [distMainPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_PATH: prismaNodeModulesRoot,
    },
  });

  appProcess.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code || 0);
  });

  appProcess.on('error', (error) => {
    console.error('[start-built] Failed to start application:', error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error('[start-built] Failed to prepare application startup:', error);
  process.exit(1);
});