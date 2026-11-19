import { createClient } from "@supabase/supabase-js";

// Public values, baked in at build time. A rebuild into another project changes both.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
