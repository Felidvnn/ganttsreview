import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { hasSupabaseConfig } from "./client";

export async function createServerSupabaseClient() {
  if (!hasSupabaseConfig) return null;
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items: { name: string; value: string; options: CookieOptions }[]) => {
          try { items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
          catch { /* Server Components cannot always write refreshed cookies. Middleware handles it. */ }
        },
      },
    },
  );
}
