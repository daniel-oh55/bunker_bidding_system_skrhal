import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const legacyDir = path.join(rootDir, 'legacy', 'firebase-prototype');
const supabaseMigrationsDir = path.join(rootDir, 'supabase', 'migrations');

const requiredDocs = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'PROJECT_STATE.md',
  path.join('docs', 'PRODUCT_AND_SCOPE.md'),
  path.join('docs', 'ARCHITECTURE.md'),
  path.join('docs', 'SECURITY_MODEL.md'),
  path.join('docs', 'AI_TASK_CARD_TEMPLATE.md'),
  path.join('docs', 'REVIEW_TEMPLATE.md'),
  path.join('.github', 'pull_request_template.md'),
];

const ignoredDirs = new Set([
  '.git',
  'dist',
  'node_modules',
  'coverage',
]);

const appFileExtensions = new Set([
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.toml',
  '.yml',
  '.yaml',
  '.env',
  '',
]);

const firebasePatterns = [
  /from\s+['"]firebase(?:\/|['"])/i,
  /require\(['"]firebase(?:\/|['"])/i,
  /firebase-(?:app|auth|firestore|storage|functions)/i,
  /firebaseConfig/i,
  /\bfirebase\.initializeApp\b/i,
  /\binitializeApp\s*\(/i,
  /\bgetAuth\s*\(/i,
  /\bgetFirestore\s*\(/i,
  /www\.gstatic\.com\/firebasejs/i,
];

const firebaseIdentifiers = [
  'spot-bidding-skrhal',
];

const forbiddenSecretPatterns = [
  /service[_-]?role/i,
  /SUPABASE_SERVICE_ROLE/i,
  /sb_service_role_/i,
];

const legacyImportPattern = /from\s+['"][^'"]*legacy\/firebase-prototype|import\(['"][^'"]*legacy\/firebase-prototype|src\s*=\s*['"][^'"]*legacy\/firebase-prototype/i;

const failures = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }

      if (fullPath === legacyDir) {
        continue;
      }

      files.push(...walk(fullPath));
      continue;
    }

    files.push({ fullPath, relPath });
  }

  return files;
}

function recordFailure(message) {
  failures.push(message);
}

function checkRequiredDocs() {
  for (const relativePath of requiredDocs) {
    if (!fs.existsSync(path.join(rootDir, relativePath))) {
      recordFailure(`Missing required documentation file: ${relativePath}`);
    }
  }
}

function checkNoMigrations() {
  if (!fs.existsSync(supabaseMigrationsDir)) {
    return;
  }

  const entries = fs.readdirSync(supabaseMigrationsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
      recordFailure(`SQL migrations are not allowed in this foundation PR: supabase/migrations/${entry.name}`);
    }
  }
}

function checkFiles() {
  for (const { fullPath, relPath } of walk(rootDir)) {
    const ext = path.extname(fullPath).toLowerCase();
    const content = fs.readFileSync(fullPath, 'utf8');
    const normalizedRelPath = relPath.split(path.sep).join('/');
    const isDoc = normalizedRelPath.endsWith('.md');
    const isAppFile = appFileExtensions.has(ext);

    if (normalizedRelPath === 'scripts/check-foundation-boundaries.mjs') {
      continue;
    }

    if (isAppFile && !isDoc) {
      for (const pattern of forbiddenSecretPatterns) {
        if (pattern.test(content)) {
          recordFailure(`Forbidden secret marker found in application file: ${normalizedRelPath}`);
          break;
        }
      }
    }

    for (const identifier of firebaseIdentifiers) {
      if (content.includes(identifier)) {
        recordFailure(`Legacy Firebase project identifier leaked outside legacy/: ${normalizedRelPath}`);
      }
    }

    for (const pattern of firebasePatterns) {
      if (pattern.test(content)) {
        recordFailure(`Firebase runtime pattern found outside legacy/: ${normalizedRelPath}`);
        break;
      }
    }

    if (legacyImportPattern.test(content)) {
      recordFailure(`Legacy prototype referenced as an active import or build input: ${normalizedRelPath}`);
    }
  }
}

checkRequiredDocs();
checkNoMigrations();
checkFiles();

if (failures.length > 0) {
  console.error('Foundation boundary check failed.');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Foundation boundary check passed.');
