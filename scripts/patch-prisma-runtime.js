const fs = require('node:fs');
const path = require('node:path');

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
const runtimeRoot = path.relative(projectRoot, path.join(prismaNodeModulesRoot, '@prisma', 'client', 'runtime'));

const generatedRoots = [
  {
    root: path.join(projectRoot, 'src', 'generated', 'prisma'),
    mode: 'source',
  },
  {
    root: path.join(projectRoot, 'dist', 'src', 'generated', 'prisma'),
    mode: 'dist',
    importBaseDir: projectRoot,
  },
];

const runtimeTargets = {
  '@prisma/client/runtime/client': `${runtimeRoot}/client.js`,
  '@prisma/client/runtime/index-browser': `${runtimeRoot}/index-browser.js`,
  '@prisma/client/runtime/query_compiler_fast_bg.postgresql.js': `${runtimeRoot}/query_compiler_fast_bg.postgresql.js`,
  '@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.js': `${runtimeRoot}/query_compiler_fast_bg.postgresql.wasm-base64.js`,
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectGeneratedFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files = [];
  const pending = [root];

  while (pending.length > 0) {
    const currentPath = pending.pop();
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function buildImportPattern(originalImport) {
  const escapedImport = escapeRegExp(originalImport);
  return new RegExp(`(?:(?:\\.\\.?/)+(?:node_modules/)?|(?:\\.deps/node_modules/))*${escapedImport}(?:\\.js)*`, 'g');
}

function toImportPath(fromFile, target, importBaseDir) {
  const resolvedFromDir = path.join(importBaseDir, path.relative(projectRoot, path.dirname(fromFile)));
  let relativePath = path.relative(resolvedFromDir, path.join(projectRoot, target)).replace(/\\/g, '/');

  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }

  return relativePath;
}

let patchedFileCount = 0;

for (const { root, mode, importBaseDir } of generatedRoots) {
  for (const absoluteFile of collectGeneratedFiles(root)) {
    let content = fs.readFileSync(absoluteFile, 'utf8');
    const originalContent = content;

    for (const [originalImport, targetPath] of Object.entries(runtimeTargets)) {
      const replacement =
        mode === 'source'
          ? originalImport
          : toImportPath(absoluteFile, targetPath, importBaseDir);

      content = content.replace(buildImportPattern(originalImport), replacement);
    }

    if (content !== originalContent) {
      fs.writeFileSync(absoluteFile, content, 'utf8');
      patchedFileCount += 1;
    }
  }
}

console.log(`Patched Prisma runtime imports for local .deps resolution in ${patchedFileCount} file(s).`);