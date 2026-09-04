import { NextResponse } from "next/server";
import { createUserServerClient } from "@/lib/supabase/server";

async function signOut(request: Request) {
  const supabase = await createUserServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}

export async function GET(request: Request) {
  return signOut(request);
}

export async function POST(request: Request) {
  return signOut(request);
}
