import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const checkerPath = path.join(testDir, 'check-foundation-boundaries.mjs');
const fixtureRoots = [];

const requiredDocs = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'PROJECT_STATE.md',
  'docs/PRODUCT_AND_SCOPE.md',
  'docs/ARCHITECTURE.md',
  'docs/SECURITY_MODEL.md',
  'docs/AI_TASK_CARD_TEMPLATE.md',
  'docs/REVIEW_TEMPLATE.md',
  '.github/pull_request_template.md',
];

const requiredLegacyFiles = [
  '.firebaserc',
  'README.md',
  'firebase.json',
  'firestore.rules',
  'index.html',
  'vercel.json',
];

const signupSettings = [
  { section: 'auth', key: 'enable_signup' },
  { section: 'auth', key: 'enable_anonymous_sign_ins' },
  { section: 'auth.email', key: 'enable_signup' },
  { section: 'auth.sms', key: 'enable_signup' },
];

const requiredEnvPlaceholders = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
];
const signupFailureCategories = {
  missing: 'Missing required signup setting',
  duplicated: 'Duplicated signup setting',
  malformed: 'Malformed signup setting',
  'non-false': 'Signup setting must be false',
};
const legacyProjectIdentifier = ['spot', 'bidding', 'skrhal'].join('-');
const firebaseNamespace = ['fire', 'base'].join('');
const legacyPrototypePath = ['..', 'legacy', `${firebaseNamespace}-prototype`, 'index.html'].join(
  '/',
);
const templateDelimiter = String.fromCharCode(96);

function canCreateFileSymlinks() {
  if (process.platform !== 'win32') {
    return true;
  }

  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundation-file-link-probe-'));
  const targetPath = path.join(probeRoot, 'target.txt');
  const linkPath = path.join(probeRoot, 'link.txt');

  try {
    fs.writeFileSync(targetPath, 'probe\n', 'utf8');
    fs.symlinkSync(targetPath, linkPath, 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

const fileSymlinksAvailable = canCreateFileSymlinks();

function writeFixtureFile(root, relativePath, content = '') {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function replaceFixturePathWithDirectoryLink(root, relativePath, targetPath) {
  const linkPath = path.join(root, relativePath);
  let target = targetPath;
  if (!target) {
    target = fs.mkdtempSync(path.join(os.tmpdir(), 'foundation-link-target-'));
    fixtureRoots.push(target);
  }

  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function replaceFixtureFileWithFileSymlink(root, relativePath) {
  const linkPath = path.join(root, relativePath);
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundation-file-link-target-'));
  const targetPath = path.join(targetRoot, path.basename(relativePath));
  fixtureRoots.push(targetRoot);

  fs.copyFileSync(linkPath, targetPath);
  fs.rmSync(linkPath);
  fs.symlinkSync(targetPath, linkPath, 'file');
}

function renderConfig(mutation = {}) {
  const lines = [];
  for (const [index, setting] of signupSettings.entries()) {
    if (index === 0 || signupSettings[index - 1].section !== setting.section) {
      lines.push(`[${setting.section}]`);
    }

    if (mutation.index === index && mutation.mode === 'missing') {
      continue;
    }

    if (mutation.index === index && mutation.mode === 'malformed') {
      lines.push(`${setting.key} false`);
      continue;
    }

    const value = mutation.index === index && mutation.mode === 'non-false' ? 'true' : 'false';
    lines.push(`${setting.key} = ${value}`);

    if (mutation.index === index && mutation.mode === 'duplicated') {
      lines.push(`${setting.key} = false`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function createPassingFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundation-checker-'));
  fixtureRoots.push(root);

  for (const relativePath of requiredDocs) {
    writeFixtureFile(root, relativePath, '# Fixture\n');
  }

  for (const relativePath of requiredLegacyFiles) {
    writeFixtureFile(root, path.join('legacy', 'firebase-prototype', relativePath), 'legacy fixture\n');
  }
  const ignoredLegacyStatement = ['CREATE', 'TABLE'].join(' ');
  writeFixtureFile(
    root,
    path.join('legacy', 'firebase-prototype', 'nested', 'ignored-schema.sql'),
    `${ignoredLegacyStatement} ignored_fixture (id bigint);\n`,
  );

  writeFixtureFile(root, 'supabase/config.toml', renderConfig());
  writeFixtureFile(
    root,
    '.env.example',
    `${requiredEnvPlaceholders.map((name) => `${name}=`).join('\n')}\n`,
  );

  return root;
}

function runChecker(root) {
  const result = spawnSync(process.execPath, [checkerPath], {
    cwd: root,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function expectFailure(root, expectedMessage) {
  const result = runChecker(root);
  expect(result.status).toBe(1);
  expect(result.output).toContain('Foundation boundary check failed.');
  expect(result.output).toContain(expectedMessage);
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0).reverse()) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('foundation boundary checker', () => {
  it('accepts a complete passing fixture', () => {
    const root = createPassingFixture();
    const result = runChecker(root);

    expect(result.status).toBe(0);
    expect(result.output).toContain('Foundation boundary check passed.');
  });

  it('rejects a root Supabase schema SQL file', () => {
    const root = createPassingFixture();
    writeFixtureFile(root, 'supabase/schema.sql', 'select 1;\n');

    expectFailure(root, 'SQL files are not allowed');
  });

  it('rejects a nested SQL file outside the migrations directory', () => {
    const root = createPassingFixture();
    writeFixtureFile(root, 'src/database/nested/deeper/fixture.SQL', 'select 1;\n');

    expectFailure(root, 'SQL files are not allowed');
  });

  for (const implementationCase of [
    {
      name: 'table-definition statement',
      parts: ['CREATE', 'TABLE'],
      render: (statement) => `${statement} fixture_table (id bigint);\n`,
    },
    {
      name: 'policy-definition statement',
      parts: ['CREATE', 'POLICY'],
      render: (statement) => `${statement} fixture_policy ON fixture_table USING (true);\n`,
    },
    {
      name: 'row-security enablement statement',
      parts: ['ENABLE', 'ROW', 'LEVEL', 'SECURITY'],
      render: (statement) => `ALTER TABLE fixture_table ${statement};\n`,
    },
  ]) {
    it(`rejects an embedded ${implementationCase.name}`, () => {
      const root = createPassingFixture();
      const statement = implementationCase.parts.join(' ');
      writeFixtureFile(root, 'src/schema-implementation.ts', implementationCase.render(statement));

      expectFailure(root, 'Schema/RLS SQL implementation found in active source');
    });
  }

  it('allows schema terminology in Markdown prose', () => {
    const root = createPassingFixture();
    const proseStatement = ['CREATE', 'TABLE'].join(' ');
    writeFixtureFile(root, 'docs/SCHEMA_NOTES.md', `Discuss ${proseStatement} without implementing it.\n`);
    const result = runChecker(root);

    expect(result.status).toBe(0);
    expect(result.output).toContain('Foundation boundary check passed.');
  });

  for (const implementationCase of [
    ['CREATE', 'TABLE'],
    ['CREATE', 'POLICY'],
    ['ENABLE', 'ROW', 'LEVEL', 'SECURITY'],
  ]) {
    it(`rejects embedded schema/RLS implementation in MDX: ${implementationCase.join(' ')}`, () => {
      const root = createPassingFixture();
      const statement = implementationCase.join(' ');
      writeFixtureFile(
        root,
        'docs/EXECUTABLE_SCHEMA.mdx',
        `export const implementation = ${JSON.stringify(statement)};\n`,
      );

      expectFailure(root, 'Schema/RLS SQL implementation found in active source');
    });
  }

  it('rejects a directory link in the active repository tree', () => {
    const root = createPassingFixture();
    replaceFixturePathWithDirectoryLink(root, 'src/linked-fixture');

    expectFailure(
      root,
      'Symbolic link is not allowed in the active repository tree: src/linked-fixture',
    );
  });

  for (const requiredLinkCase of [
    {
      path: 'README.md',
      message: 'Missing required documentation file: README.md',
    },
    {
      path: 'supabase/config.toml',
      message: 'Missing required Supabase config: supabase/config.toml',
    },
    {
      path: '.env.example',
      message: 'Missing required environment template: .env.example',
    },
    {
      path: 'legacy/firebase-prototype/README.md',
      message: 'Missing required legacy file: legacy/firebase-prototype/README.md',
    },
  ]) {
    it(`rejects a linked required file: ${requiredLinkCase.path}`, () => {
      const root = createPassingFixture();
      replaceFixturePathWithDirectoryLink(root, requiredLinkCase.path);

      expectFailure(root, requiredLinkCase.message);
    });
  }

  describe.skipIf(process.platform === 'win32' && !fileSymlinksAvailable)(
    'required file symlinks',
    () => {
      for (const requiredLinkCase of [
        {
          path: 'README.md',
          message: 'Missing required documentation file: README.md',
        },
        {
          path: 'supabase/config.toml',
          message: 'Missing required Supabase config: supabase/config.toml',
        },
        {
          path: '.env.example',
          message: 'Missing required environment template: .env.example',
        },
        {
          path: 'legacy/firebase-prototype/README.md',
          message: 'Missing required legacy file: legacy/firebase-prototype/README.md',
        },
      ]) {
        it(`rejects an actual file symlink at a required path: ${requiredLinkCase.path}`, () => {
          const root = createPassingFixture();
          replaceFixtureFileWithFileSymlink(root, requiredLinkCase.path);

          expectFailure(root, requiredLinkCase.message);
        });
      }
    },
  );

  for (const ignoredName of ['dist', 'coverage', 'node_modules']) {
    it(`rejects an ignored-name directory link: src/${ignoredName}`, () => {
      const root = createPassingFixture();
      const linkPath = `src/${ignoredName}`;

      if (ignoredName === 'dist') {
        writeFixtureFile(
          root,
          path.join('legacy', 'firebase-prototype', 'app.js'),
          'export default {};\n',
        );
        replaceFixturePathWithDirectoryLink(
          root,
          linkPath,
          path.join(root, 'legacy', 'firebase-prototype'),
        );
        writeFixtureFile(
          root,
          'src/active-import.ts',
          `import fixture from './${ignoredName}/app.js';\nexport default fixture;\n`,
        );
      } else {
        replaceFixturePathWithDirectoryLink(root, linkPath);
      }

      const result = runChecker(root);
      expect(result.status).toBe(1);
      expect(result.output).toContain('Foundation boundary check failed.');
      expect(result.output).toContain(
        `Symbolic link is not allowed in the active repository tree: ${linkPath}`,
      );
      if (ignoredName === 'dist') {
        expect(result.output).not.toContain(
          'Legacy prototype referenced as an active import or build input',
        );
      }
    });

    it(`continues to ignore a real directory named src/${ignoredName}`, () => {
      const root = createPassingFixture();
      writeFixtureFile(root, `src/${ignoredName}/ignored.sql`, 'select 1;\n');
      const result = runChecker(root);

      expect(result.status).toBe(0);
      expect(result.output).toContain('Foundation boundary check passed.');
    });

    it(`scans a regular file named src/${ignoredName}`, () => {
      const root = createPassingFixture();
      const statement = ['CREATE', 'TABLE'].join(' ');
      writeFixtureFile(root, `src/${ignoredName}`, `${statement} fixture_table (id bigint);\n`);

      expectFailure(root, 'Schema/RLS SQL implementation found in active source');
    });
  }

  for (const legacyFile of requiredLegacyFiles) {
    it(`rejects a missing required legacy file: ${legacyFile}`, () => {
      const root = createPassingFixture();
      fs.rmSync(path.join(root, 'legacy', 'firebase-prototype', legacyFile));

      expectFailure(root, `Missing required legacy file: legacy/firebase-prototype/${legacyFile}`);
    });
  }

  for (const [index, setting] of signupSettings.entries()) {
    const settingPath = `${setting.section}.${setting.key}`;
    for (const mode of ['missing', 'duplicated', 'malformed', 'non-false']) {
      it(`rejects ${mode} signup setting: ${settingPath}`, () => {
        const root = createPassingFixture();
        writeFixtureFile(root, 'supabase/config.toml', renderConfig({ index, mode }));

        expectFailure(root, signupFailureCategories[mode]);
      });
    }
  }

  it('rejects a missing required documentation file', () => {
    const root = createPassingFixture();
    fs.rmSync(path.join(root, 'docs', 'ARCHITECTURE.md'));

    expectFailure(root, 'Missing required documentation file: docs/ARCHITECTURE.md');
  });

  it('rejects a missing Supabase config', () => {
    const root = createPassingFixture();
    fs.rmSync(path.join(root, 'supabase', 'config.toml'));

    expectFailure(root, 'Missing required Supabase config: supabase/config.toml');
  });

  it('rejects a missing environment template', () => {
    const root = createPassingFixture();
    fs.rmSync(path.join(root, '.env.example'));

    expectFailure(root, 'Missing required environment template: .env.example');
  });

  it('rejects a duplicated required environment placeholder', () => {
    const root = createPassingFixture();
    const duplicatedPlaceholder = requiredEnvPlaceholders[0];
    const content = [
      ...requiredEnvPlaceholders.map((name) => `${name}=`),
      `${duplicatedPlaceholder}=`,
    ].join('\n');
    writeFixtureFile(root, '.env.example', `${content}\n`);

    expectFailure(root, `Duplicated environment placeholder: ${duplicatedPlaceholder}`);
  });

  for (const placeholder of requiredEnvPlaceholders) {
    it(`rejects a missing required environment placeholder: ${placeholder}`, () => {
      const root = createPassingFixture();
      const content = requiredEnvPlaceholders
        .filter((name) => name !== placeholder)
        .map((name) => `${name}=`)
        .join('\n');
      writeFixtureFile(root, '.env.example', `${content}\n`);

      expectFailure(root, `Missing required empty placeholder: ${placeholder}`);
    });

    it(`rejects a non-empty required environment placeholder: ${placeholder}`, () => {
      const root = createPassingFixture();
      const content = requiredEnvPlaceholders
        .map((name) => `${name}=${name === placeholder ? 'fixture-value' : ''}`)
        .join('\n');
      writeFixtureFile(root, '.env.example', `${content}\n`);

      expectFailure(root, `Environment placeholder must be empty: ${placeholder}`);
    });
  }

  it('rejects the legacy anon-key Vite variable', () => {
    const root = createPassingFixture();
    const variableName = ['VITE', 'SUPABASE', 'ANON', 'KEY'].join('_');
    writeFixtureFile(root, '.env.local', `${variableName}=fixture\n`);

    expectFailure(root, 'Legacy Supabase anon Vite variable');
  });

  for (const suffix of [
    ['SECRET', 'KEY'].join('_'),
    ['SERVICE', 'ROLE', 'KEY'].join('_'),
  ]) {
    it(`rejects a browser/Vite ${suffix.toLowerCase()} variable`, () => {
      const root = createPassingFixture();
      const variableName = ['VITE', 'SUPABASE', suffix].join('_');
      writeFixtureFile(root, '.env.local', `${variableName}=fixture\n`);

      expectFailure(root, 'Browser/Vite elevated credential variable');
    });
  }

  for (const markerParts of [
    ['sb', 'secret', 'fixture'],
    ['service', 'role'],
    ['SUPABASE', 'SECRET', 'KEY'],
  ]) {
    it(`rejects elevated credential marker: ${markerParts.join('-')}`, () => {
      const root = createPassingFixture();
      const marker = markerParts.join('_');
      writeFixtureFile(root, 'src/credential.ts', `export const credential = '${marker}';\n`);

      expectFailure(root, 'Elevated credential marker');
    });
  }

  it('rejects the legacy Firebase project identifier', () => {
    const root = createPassingFixture();
    writeFixtureFile(
      root,
      'src/project-identifier.ts',
      `export const projectIdentifier = '${legacyProjectIdentifier}';\n`,
    );

    expectFailure(root, 'Legacy Firebase project identifier leaked outside legacy/');
  });

  it('rejects Firebase runtime code outside the legacy directory', () => {
    const root = createPassingFixture();
    const initializeAppName = ['initialize', 'App'].join('');
    const packageName = [firebaseNamespace, 'app'].join('/');
    writeFixtureFile(
      root,
      'src/runtime-client.ts',
      `import { ${initializeAppName} } from '${packageName}';\n${initializeAppName}({});\n`,
    );

    expectFailure(root, 'Firebase runtime pattern found outside legacy/');
  });

  for (const scannerPath of [
    'scripts/check-foundation-boundaries.mjs',
    'scripts/check-foundation-boundaries.test.mjs',
  ]) {
    it(`scans forbidden content at the checker path: ${scannerPath}`, () => {
      const root = createPassingFixture();
      writeFixtureFile(
        root,
        scannerPath,
        `export const projectIdentifier = '${legacyProjectIdentifier}';\n`,
      );

      expectFailure(root, 'Legacy Firebase project identifier leaked outside legacy/');
    });
  }

  for (const buildInputCase of [
    {
      name: 'static module import',
      extension: 'ts',
      render: (legacyPath) => `import fixture from '${legacyPath}';\nexport default fixture;\n`,
    },
    {
      name: 'dynamic module import',
      extension: 'ts',
      render: (legacyPath) => `export const fixture = import('${legacyPath}');\n`,
    },
    {
      name: 'CommonJS loader',
      extension: 'cjs',
      render: (legacyPath) => `module.exports = require('${legacyPath}');\n`,
    },
    {
      name: 'HTML source attribute',
      extension: 'html',
      render: (legacyPath) => `<script src="${legacyPath}"></script>\n`,
    },
    {
      name: 'HTML link attribute',
      extension: 'html',
      render: (legacyPath) => `<link href="${legacyPath}" rel="stylesheet">\n`,
    },
    {
      name: 'CSS direct import',
      extension: 'css',
      render: (legacyPath) => `@import '${legacyPath}';\n`,
    },
    {
      name: 'CSS URL import',
      extension: 'css',
      render: (legacyPath) => `@import url('${legacyPath}');\n`,
    },
    {
      name: 'module-relative URL constructor',
      extension: 'ts',
      render: (legacyPath) => `export const fixture = new URL('${legacyPath}', import.meta.url);\n`,
    },
    {
      name: 'template-literal dynamic module import',
      extension: 'ts',
      render: (legacyPath) =>
        `export const fixture = import(${templateDelimiter}${legacyPath}${templateDelimiter});\n`,
    },
    {
      name: 'template-literal CommonJS loader',
      extension: 'cjs',
      render: (legacyPath) =>
        `module.exports = require(${templateDelimiter}${legacyPath}${templateDelimiter});\n`,
    },
    {
      name: 'template-literal module-relative URL constructor',
      extension: 'ts',
      render: (legacyPath) =>
        `export const fixture = new URL(${templateDelimiter}${legacyPath}${templateDelimiter}, import.meta.url);\n`,
    },
    {
      name: 'import.meta.glob call',
      extension: 'ts',
      render: (legacyPath) => `export const fixture = import.meta.glob('${legacyPath}');\n`,
    },
    {
      name: 'CSS URL build input without import',
      extension: 'css',
      render: (legacyPath) => `.fixture { background-image: url('${legacyPath}'); }\n`,
    },
    {
      name: 'CSS direct import without whitespace',
      extension: 'css',
      render: (legacyPath) => `@import"${legacyPath}";\n`,
    },
    {
      name: 'unquoted HTML source attribute',
      extension: 'html',
      render: (legacyPath) => `<script src=${legacyPath}></script>\n`,
    },
    {
      name: 'unquoted HTML link attribute',
      extension: 'html',
      render: (legacyPath) => `<link href=${legacyPath} rel="stylesheet">\n`,
    },
  ]) {
    it(`rejects a legacy build input through ${buildInputCase.name}`, () => {
      const root = createPassingFixture();
      writeFixtureFile(
        root,
        `src/legacy-build-input.${buildInputCase.extension}`,
        buildInputCase.render(legacyPrototypePath),
      );

      expectFailure(root, 'Legacy prototype referenced as an active import or build input');
    });
  }

  it('rejects a bare side-effect static import of the legacy prototype', () => {
    const root = createPassingFixture();
    writeFixtureFile(root, 'src/legacy-side-effect.ts', `import '${legacyPrototypePath}';\n`);

    expectFailure(root, 'Legacy prototype referenced as an active import or build input');
  });
});
