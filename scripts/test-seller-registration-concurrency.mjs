import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const [databaseUrl] = process.argv.slice(2);
if (!databaseUrl?.startsWith('postgres')) throw new Error('Expected local PostgreSQL URL.');
const applicant = randomUUID();
const database = new Client({ connectionString: databaseUrl, application_name: 'seller-registration-concurrency' });
await database.connect();
try {
  await database.query('begin');
  await database.query(`select set_config('request.jwt.claim.sub', $1, true)`, [applicant]);
  await database.query('set local role authenticated');
  const results = await Promise.allSettled([
    database.query('select * from public.submit_seller_registration_request($1)', ['Concurrent Seller']),
    database.query('select * from public.submit_seller_registration_request($1)', ['Concurrent Seller']),
  ]);
  if (results.filter((result) => result.status === 'fulfilled').length !== 2) throw new Error('Idempotent duplicate submit failed.');
  await database.query('rollback');
  console.log('SELLER registration concurrency regression passed: duplicate submission idempotency.');
} finally { await database.end(); }
