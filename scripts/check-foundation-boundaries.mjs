import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(process.cwd());
const legacyDir = path.join(rootDir, 'legacy', 'firebase-prototype');
const supabaseMigrationsDir = path.join(rootDir, 'supabase', 'migrations');
const supabaseConfigPath = path.join(rootDir, 'supabase', 'config.toml');
const envExamplePath = path.join(rootDir, '.env.example');

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

const requiredLegacyFiles = [
  '.firebaserc',
  'README.md',
  'firebase.json',
  'firestore.rules',
  'index.html',
  'vercel.json',
];

const requiredSignupSettings = [
  { section: 'auth', key: 'enable_signup' },
  { section: 'auth', key: 'enable_anonymous_sign_ins' },
  { section: 'auth.email', key: 'enable_signup' },
  { section: 'auth.sms', key: 'enable_signup' },
];

const requiredEnvPlaceholders = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
];

const ignoredDirs = new Set([
  '.git',
  'dist',
  'node_modules',
  'coverage',
]);

const scannerImplementationFiles = new Set([
  'scripts/check-foundation-boundaries.mjs',
  'scripts/check-foundation-boundaries.test.mjs',
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

const forbiddenElevatedCredentialPatterns = [
  /\bSUPABASE_(?:SECRET|SERVICE_ROLE)_KEYS?\b/i,
  /\b[A-Z0-9_]*SERVICE_ROLE_KEY\b/,
  /\bsb_(?:secret|service_role)_[A-Za-z0-9_-]*/i,
  /\bservice_role\b/i,
];

const forbiddenAnonKeyPattern = /\bVITE_SUPABASE_ANON_KEY\b/;
const forbiddenBrowserCredentialEnvPattern =
  /\bVITE_[A-Z0-9_]*(?:SECRET|SERVICE[_-]?ROLE)[A-Z0-9_]*\b/i;
const legacyImportPattern =
  /from\s+['"][^'"]*legacy\/firebase-prototype|import\(['"][^'"]*legacy\/firebase-prototype|src\s*=\s*['"][^'"]*legacy\/firebase-prototype/i;

const failures = [];

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name) || fullPath === legacyDir) {
        continue;
      }

      files.push(...walk(fullPath));
      continue;
    }

    if (entry.isFile()) {
      files.push({
        fullPath,
        relPath: path.relative(rootDir, fullPath),
      });
    }
  }

  return files;
}

function recordFailure(message) {
  failures.push(message);
}

function checkRequiredDocs() {
  for (const relativePath of requiredDocs) {
    if (!isFile(path.join(rootDir, relativePath))) {
      recordFailure(`Missing required documentation file: ${normalizeRelativePath(relativePath)}`);
    }
  }
}

function checkRequiredLegacyFiles() {
  for (const relativePath of requiredLegacyFiles) {
    const filePath = path.join(legacyDir, relativePath);
    if (!isFile(filePath)) {
      recordFailure(`Missing required legacy file: legacy/firebase-prototype/${relativePath}`);
    }
  }
}

function findSqlMigrations(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const migrations = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      migrations.push(...findSqlMigrations(fullPath));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.sql') {
      migrations.push(fullPath);
    }
  }

  return migrations;
}

function checkNoMigrations() {
  for (const migrationPath of findSqlMigrations(supabaseMigrationsDir)) {
    const relativePath = normalizeRelativePath(path.relative(rootDir, migrationPath));
    recordFailure(`SQL migrations are not allowed in this foundation PR: ${relativePath}`);
  }
}

function checkSignupSettings() {
  if (!isFile(supabaseConfigPath)) {
    recordFailure('Missing required Supabase config: supabase/config.toml');
    return;
  }

  const valuesBySetting = new Map(
    requiredSignupSettings.map(({ section, key }) => [`${section}.${key}`, []]),
  );
  let currentSection = '';

  for (const [index, rawLine] of fs.readFileSync(supabaseConfigPath, 'utf8').split(/\r?\n/).entries()) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    if (line.startsWith('[')) {
      currentSection = '';
      continue;
    }

    const assignmentMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/);
    if (assignmentMatch) {
      const settingPath = `${currentSection}.${assignmentMatch[1]}`;
      const values = valuesBySetting.get(settingPath);
      if (values) {
        values.push({
          value: assignmentMatch[2],
          line: index + 1,
        });
      }
      continue;
    }

    const malformedSetting = requiredSignupSettings.find(
      ({ section, key }) => section === currentSection && line.startsWith(key),
    );
    if (malformedSetting) {
      recordFailure(
        `Malformed signup setting ${currentSection}.${malformedSetting.key} on line ${index + 1}`,
      );
    }
  }

  for (const { section, key } of requiredSignupSettings) {
    const settingPath = `${section}.${key}`;
    const values = valuesBySetting.get(settingPath);

    if (values.length === 0) {
      recordFailure(`Missing required signup setting: ${settingPath}`);
      continue;
    }

    if (values.length > 1) {
      recordFailure(`Duplicated signup setting: ${settingPath}`);
    }

    for (const { value, line } of values) {
      if (value !== 'false') {
        recordFailure(`Signup setting must be false: ${settingPath} (line ${line})`);
      }
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkEnvPlaceholders() {
  if (!isFile(envExamplePath)) {
    recordFailure('Missing required environment template: .env.example');
    return;
  }

  const lines = fs.readFileSync(envExamplePath, 'utf8').split(/\r?\n/);
  for (const variableName of requiredEnvPlaceholders) {
    const assignmentPattern = new RegExp(`^\\s*${escapeRegExp(variableName)}\\s*=(.*)$`);
    const matches = lines
      .map((line, index) => ({ match: line.match(assignmentPattern), line: index + 1 }))
      .filter(({ match }) => match);

    if (matches.length === 0) {
      recordFailure(`Missing required empty placeholder: ${variableName}`);
      continue;
    }

    if (matches.length > 1) {
      recordFailure(`Duplicated environment placeholder: ${variableName}`);
    }

    for (const { match, line } of matches) {
      if (match[1].trim() !== '') {
        recordFailure(`Environment placeholder must be empty: ${variableName} (line ${line})`);
      }
    }
  }
}

function checkFiles() {
  for (const { fullPath, relPath } of walk(rootDir)) {
    const normalizedRelPath = normalizeRelativePath(relPath);
    if (scannerImplementationFiles.has(normalizedRelPath)) {
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');

    if (forbiddenAnonKeyPattern.test(content)) {
      recordFailure(`Legacy Supabase anon Vite variable found outside legacy/: ${normalizedRelPath}`);
    }

    if (forbiddenBrowserCredentialEnvPattern.test(content)) {
      recordFailure(`Browser/Vite elevated credential variable found outside legacy/: ${normalizedRelPath}`);
    }

    for (const pattern of forbiddenElevatedCredentialPatterns) {
      if (pattern.test(content)) {
        recordFailure(`Elevated credential marker found outside legacy/: ${normalizedRelPath}`);
        break;
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
checkRequiredLegacyFiles();
checkNoMigrations();
checkSignupSettings();
checkEnvPlaceholders();
checkFiles();

if (failures.length > 0) {
  console.error('Foundation boundary check failed.');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Foundation boundary check passed.');
