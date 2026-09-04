import { NextResponse } from "next/server";
import { createUserServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createUserServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url));
}
