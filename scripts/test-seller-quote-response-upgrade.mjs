import { spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args) => {
  const result = spawnSync(npx, ['--no-install', 'supabase', ...args], { cwd: process.cwd(), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`supabase ${args.join(' ')} failed with exit code ${result.status}`);
};

let failure;
try {
  run(['db', 'reset', '--local', '--version', '20260831071010', '--sql-paths', 'tests/database/fixtures/seller_quote_response_upgrade_pre.seed']);
  run(['migration', 'up', '--local']);
  run(['test', 'db', '--local', 'supabase/tests/database/11_seller_quote_response_upgrade.sql']);
  console.log('Seller quote response upgrade regression passed.');
} catch (error) {
  failure = error;
}

try {
  run(['db', 'reset', '--local']);
} catch (error) {
  failure ??= error;
}

if (failure) throw failure;
