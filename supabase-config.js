/* ============================================
   NEURO-LEVELING — Supabase Configuration
   
   ISTRUZIONI:
   1. Vai su https://supabase.com → Sign Up (gratis con GitHub)
   2. Crea un nuovo progetto (nome: neuro-leveling, password qualsiasi, region: EU West)
   3. Vai su Project Settings → API
   4. Copia "Project URL" e "anon public" key qui sotto
   5. Vai su Authentication → Providers → abilita Google
      (serve creare credenziali OAuth su Google Cloud Console)
   6. Vai su Authentication → URL Configuration →
      aggiungi Site URL: https://amedeosb.github.io/neuro-leveling/
      aggiungi Redirect URL: https://amedeosb.github.io/neuro-leveling/
   7. Vai su SQL Editor ed esegui questa query:

      CREATE TABLE players (
        id UUID PRIMARY KEY REFERENCES auth.users(id),
        state JSONB DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      ALTER TABLE players ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Users can read own data" ON players FOR SELECT USING (auth.uid() = id);
      CREATE POLICY "Users can insert own data" ON players FOR INSERT WITH CHECK (auth.uid() = id);
      CREATE POLICY "Users can update own data" ON players FOR UPDATE USING (auth.uid() = id);

   ============================================ */

const SUPABASE_URL = 'LA_TUA_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'LA_TUA_ANON_KEY';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
