import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Cliente único de Supabase. No usamos Supabase Auth: la identidad de cada
 * participante es (sala + nombre) y se recuerda con un token de sesión propio.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

export function getSupabase(): SupabaseClient {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  return supabase;
}
