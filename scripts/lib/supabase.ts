import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.SUPAB_URL;
  const key = process.env.SUPAB_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPAB_URL or SUPAB_SERVICE_ROLE_KEY environment variables"
    );
  }

  return createClient(url, key);
}
