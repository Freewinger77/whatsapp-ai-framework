import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

export async function GET(request: Request) {
  const url = new URL("/login", request.url);
  const res = NextResponse.redirect(url);
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
