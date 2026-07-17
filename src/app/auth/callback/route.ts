import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const destination = new URL("/dashboard", requestUrl.origin);

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = supabase ? await supabase.auth.exchangeCodeForSession(code) : { error: new Error("Supabase no está configurado") };
    if (!error) return NextResponse.redirect(destination);
  }

  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("authError", "confirmation");
  return NextResponse.redirect(loginUrl);
}
