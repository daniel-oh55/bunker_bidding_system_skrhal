import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(process.cwd());
const legacyDir = path.join(rootDir, 'legacy', 'firebase-prototype');
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

const markdownProseExtensions = new Set(['.md', '.markdown']);
const firebaseNamespace = ['fire', 'base'].join('');
const initializeAppName = ['initialize', 'App'].join('');
const getAuthName = ['get', 'Auth'].join('');
const getFirestoreName = ['get', 'Firestore'].join('');
const serviceRoleUpper = ['SERVICE', 'ROLE'].join('_');
const serviceRoleLower = ['service', 'role'].join('_');
const legacyPrototypeReference = ['legacy', `${firebaseNamespace}-prototype`].join('/');
const stringDelimiterPattern = "['\"`]";
const nonStringDelimiterPattern = "[^'\"`]*";
const unquotedAttributePrefixPattern = "[^\\s'\"`=<>]*";
const escapedLegacyPrototypeReference = escapeRegExp(legacyPrototypeReference);
const legacyReferencePattern =
  `${nonStringDelimiterPattern}${escapedLegacyPrototypeReference}`;

const firebasePatterns = [
  new RegExp(`from\\s+['"]${firebaseNamespace}(?:\\/|['"])`, 'i'),
  new RegExp(`require\\s*\\(\\s*['"]${firebaseNamespace}(?:\\/|['"])`, 'i'),
  new RegExp(`${firebaseNamespace}-(?:app|auth|firestore|storage|functions)`, 'i'),
  new RegExp(`${firebaseNamespace}${'Config'}`, 'i'),
  new RegExp(`\\b${firebaseNamespace}\\.${initializeAppName}\\b`, 'i'),
  new RegExp(`\\b${initializeAppName}\\s*\\(`, 'i'),
  new RegExp(`\\b${getAuthName}\\s*\\(`, 'i'),
  new RegExp(`\\b${getFirestoreName}\\s*\\(`, 'i'),
  new RegExp(`www\\.gstatic\\.com\\/${firebaseNamespace}js`, 'i'),
];

const firebaseIdentifiers = [
  ['spot', 'bidding', 'skrhal'].join('-'),
];

const forbiddenElevatedCredentialPatterns = [
  new RegExp(`\\bSUPABASE_(?:SECRET|${serviceRoleUpper})_KEYS?\\b`, 'i'),
  new RegExp(`\\b[A-Z0-9_]*${serviceRoleUpper}_KEY\\b`),
  new RegExp(`\\bsb_(?:secret|${serviceRoleLower})_[A-Za-z0-9_-]*`, 'i'),
  new RegExp(`\\b${serviceRoleLower}\\b`, 'i'),
];

const forbiddenAnonKeyPattern = new RegExp(
  `\\b${['VITE', 'SUPABASE', 'ANON', 'KEY'].join('_')}\\b`,
);
const forbiddenBrowserCredentialEnvPattern =
  /\bVITE_[A-Z0-9_]*(?:SECRET|SERVICE[_-]?ROLE)[A-Z0-9_]*\b/i;
const legacyBuildInputPatterns = [
  new RegExp(`\\bfrom\\s+${stringDelimiterPattern}${legacyReferencePattern}`, 'i'),
  new RegExp(`\\bimport\\s*${stringDelimiterPattern}${legacyReferencePattern}`, 'i'),
  new RegExp(
    `\\bimport\\s*\\(\\s*${stringDelimiterPattern}${legacyReferencePattern}`,
    'i',
  ),
  new RegExp(
    `\\brequire\\s*\\(\\s*${stringDelimiterPattern}${legacyReferencePattern}`,
    'i',
  ),
  new RegExp(
    `\\bimport\\.meta\\.glob\\s*\\(\\s*${stringDelimiterPattern}${legacyReferencePattern}`,
    'i',
  ),
  new RegExp(
    `\\b(?:src|href)\\s*=\\s*(?:${stringDelimiterPattern}${legacyReferencePattern}|${unquotedAttributePrefixPattern}${escapedLegacyPrototypeReference})`,
    'i',
  ),
  new RegExp(
    `@import\\s*(?:url\\(\\s*)?${stringDelimiterPattern}?${legacyReferencePattern}`,
    'i',
  ),
  new RegExp(
    `\\burl\\s*\\(\\s*${stringDelimiterPattern}?${legacyReferencePattern}`,
    'i',
  ),
  new RegExp(
    `\\bnew\\s+URL\\s*\\(\\s*${stringDelimiterPattern}${legacyReferencePattern}${nonStringDelimiterPattern}${stringDelimiterPattern}\\s*,\\s*import\\.meta\\.url\\s*\\)`,
    'i',
  ),
];
const schemaImplementationPatterns = [
  ['CREATE', 'TABLE'],
  ['CREATE', 'POLICY'],
  ['ENABLE', 'ROW', 'LEVEL', 'SECURITY'],
].map((parts) => ({
  label: parts.join(' '),
  pattern: new RegExp(`\\b${parts.join('\\s+')}\\b`, 'i'),
}));

const failures = [];

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isRegularFile(filePath) {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return false;
    }

    throw error;
  }
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath);
    const stats = fs.lstatSync(fullPath);
    if (stats.isSymbolicLink()) {
      recordFailure(
        `Symbolic link is not allowed in the active repository tree: ${normalizeRelativePath(relPath)}`,
      );
      continue;
    }

    if (stats.isDirectory()) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }

      if (fullPath === legacyDir) {
        continue;
      }
      files.push(...walk(fullPath));
      continue;
    }

    if (stats.isFile()) {
      files.push({
        fullPath,
        relPath,
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
    if (!isRegularFile(path.join(rootDir, relativePath))) {
      recordFailure(`Missing required documentation file: ${normalizeRelativePath(relativePath)}`);
    }
  }
}

function checkRequiredLegacyFiles() {
  for (const relativePath of requiredLegacyFiles) {
    const filePath = path.join(legacyDir, relativePath);
    if (!isRegularFile(filePath)) {
      recordFailure(`Missing required legacy file: legacy/firebase-prototype/${relativePath}`);
    }
  }
}

function checkSignupSettings() {
  if (!isRegularFile(supabaseConfigPath)) {
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
  if (!isRegularFile(envExamplePath)) {
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
    const extension = path.extname(fullPath).toLowerCase();

    if (extension === '.sql') {
      recordFailure(`SQL files are not allowed in this foundation PR: ${normalizedRelPath}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');

    if (!markdownProseExtensions.has(extension)) {
      for (const { label, pattern } of schemaImplementationPatterns) {
        if (pattern.test(content)) {
          recordFailure(
            `Schema/RLS SQL implementation found in active source (${label}): ${normalizedRelPath}`,
          );
          break;
        }
      }
    }

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

    for (const pattern of legacyBuildInputPatterns) {
      if (pattern.test(content)) {
        recordFailure(
          `Legacy prototype referenced as an active import or build input: ${normalizedRelPath}`,
        );
        break;
      }
    }
  }
}

checkRequiredDocs();
checkRequiredLegacyFiles();
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
