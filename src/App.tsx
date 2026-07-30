import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function createPlaceholderClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const supabaseClient = createPlaceholderClient();

const readinessLabel = supabaseClient
  ? 'Supabase client placeholder is configured.'
  : 'Supabase environment placeholders are not configured yet.';

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">SKRHAL Bunker Bidding</p>
        <h1>Supabase V2 Foundation</h1>
        <p className="lede">
          This shell establishes the rebuild baseline without migrating auth,
          workflows, or schema logic in this PR.
        </p>
      </section>

      <section className="panel" aria-labelledby="foundation-boundaries">
        <h2 id="foundation-boundaries">Foundation boundaries</h2>
        <ul>
          <li>Legacy Firebase files are preserved as reference-only assets.</li>
          <li>No production auth or role workflows are implemented here.</li>
          <li>No SQL migrations, RLS policies, or linked projects are included.</li>
          <li>Environment values stay as placeholders until a later secure setup.</li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="supabase-status">
        <h2 id="supabase-status">Supabase status</h2>
        <p>{readinessLabel}</p>
        <code>VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY</code>
      </section>
    </main>
  );
}
