import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(process.cwd());
const legacyDir = path.join(rootDir, 'legacy', 'firebase-prototype');
const supabaseConfigPath = path.join(rootDir, 'supabase', 'config.toml');
const localSupabaseTempDir = path.join(rootDir, 'supabase', '.temp');
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

const requiredAuthSettings = [
  { section: 'auth', key: 'enable_signup', expected: false },
  { section: 'auth', key: 'enable_anonymous_sign_ins', expected: false },
  { section: 'auth.email', key: 'enable_signup', expected: true },
  { section: 'auth.sms', key: 'enable_signup', expected: false },
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
const approvedSqlPathPrefixes = [
  'supabase/migrations/',
  'supabase/tests/database/',
];
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

const forbiddenElevatedCredentialNamePatterns = [
  new RegExp(`\\bSUPABASE_(?:SECRET|${serviceRoleUpper})_KEYS?\\b`, 'i'),
  new RegExp(`\\b[A-Z0-9_]*${serviceRoleUpper}_KEY\\b`),
];
const forbiddenElevatedCredentialValuePatterns = [
  new RegExp(`\\bsb_(?:secret|${serviceRoleLower})_[A-Za-z0-9_-]*`, 'i'),
];
const forbiddenElevatedRoleIdentifierPattern = new RegExp(`\\b${serviceRoleLower}\\b`, 'i');

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
      if (fullPath === localSupabaseTempDir || ignoredDirs.has(entry.name)) {
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

function isApprovedSqlPath(relativePath) {
  return approvedSqlPathPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function isServerOnlyEdgeFunctionPath(relativePath) {
  return relativePath.startsWith('supabase/functions/');
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

function checkRequiredAuthSettings() {
  if (!isRegularFile(supabaseConfigPath)) {
    recordFailure('Missing required Supabase config: supabase/config.toml');
    return;
  }

  const valuesBySetting = new Map(
    requiredAuthSettings.map(({ section, key }) => [`${section}.${key}`, []]),
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

    const malformedSetting = requiredAuthSettings.find(
      ({ section, key }) => (
        section === currentSection
        && (line === key || line.startsWith(`${key} `) || line.startsWith(`${key}\t`))
      ),
    );
    if (malformedSetting) {
      recordFailure(
        `Malformed required Auth setting ${currentSection}.${malformedSetting.key} on line ${index + 1}; expected boolean ${malformedSetting.expected}.`,
      );
    }
  }

  for (const { section, key, expected } of requiredAuthSettings) {
    const settingPath = `${section}.${key}`;
    const values = valuesBySetting.get(settingPath);

    if (values.length === 0) {
      recordFailure(`Missing required Auth setting: ${settingPath}; expected ${expected}.`);
      continue;
    }

    if (values.length > 1) {
      const lines = values.map((value) => value.line).join(', ');
      recordFailure(
        `Duplicated required Auth setting: ${settingPath} on lines ${lines}; expected ${expected}.`,
      );
    }

    for (const { value, line } of values) {
      if (value !== String(expected)) {
        recordFailure(
          `Required Auth setting ${settingPath} on line ${line} must be ${expected}; found ${value}.`,
        );
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

    const isApprovedSqlFile = extension === '.sql' && isApprovedSqlPath(normalizedRelPath);
    const isServerOnlyEdgeFunctionFile = isServerOnlyEdgeFunctionPath(normalizedRelPath);
    if (extension === '.sql' && !isApprovedSqlFile) {
      recordFailure(
        `SQL files are only allowed in supabase/migrations/ or supabase/tests/database/: ${normalizedRelPath}`,
      );
    }

    const content = fs.readFileSync(fullPath, 'utf8');

    if (!markdownProseExtensions.has(extension) && !isApprovedSqlFile) {
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

    for (const pattern of forbiddenElevatedCredentialNamePatterns) {
      if (!isServerOnlyEdgeFunctionFile && pattern.test(content)) {
        recordFailure(`Elevated credential marker found outside legacy/: ${normalizedRelPath}`);
        break;
      }
    }

    for (const pattern of forbiddenElevatedCredentialValuePatterns) {
      if (pattern.test(content)) {
        recordFailure(`Elevated credential value found outside legacy/: ${normalizedRelPath}`);
        break;
      }
    }

    if (
      !isApprovedSqlFile
      && !isServerOnlyEdgeFunctionFile
      && forbiddenElevatedRoleIdentifierPattern.test(content)
    ) {
      recordFailure(`Elevated credential marker found outside legacy/: ${normalizedRelPath}`);
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
checkRequiredAuthSettings();
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
