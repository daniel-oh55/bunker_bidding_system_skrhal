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

function writeFixtureFile(root, relativePath, content = '') {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
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
  for (const root of fixtureRoots.splice(0)) {
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

  it('rejects SQL migrations at any depth', () => {
    const root = createPassingFixture();
    writeFixtureFile(root, 'supabase/migrations/nested/deeper/001_fixture.SQL', 'select 1;\n');

    expectFailure(root, 'SQL migrations are not allowed');
  });

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

        expectFailure(root, settingPath);
      });
    }
  }

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

  for (const suffix of ['SECRET_KEY', 'SERVICE_ROLE_KEY']) {
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

  it('rejects Firebase runtime code outside the legacy directory', () => {
    const root = createPassingFixture();
    writeFixtureFile(
      root,
      'src/firebase.ts',
      "import { initializeApp } from 'firebase/app';\ninitializeApp({});\n",
    );

    expectFailure(root, 'Firebase runtime pattern found outside legacy/');
  });

  it('rejects active imports from the legacy prototype', () => {
    const root = createPassingFixture();
    writeFixtureFile(
      root,
      'src/legacy.ts',
      "import fixture from '../legacy/firebase-prototype/index.html';\nexport default fixture;\n",
    );

    expectFailure(root, 'Legacy prototype referenced as an active import or build input');
  });
});
