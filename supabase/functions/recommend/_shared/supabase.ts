import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export function createSupabaseClient(): SupabaseClient {
  const url = Deno.env.get("SUPAB_URL");
  const key = Deno.env.get("SUPAB_ANON_KEY");

  if (!url || !key) {
    throw new Error("Missing SUPAB_URL or SUPAB_ANON_KEY");
  }

  return createClient(url, key);
}
