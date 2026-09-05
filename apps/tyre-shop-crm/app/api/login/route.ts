import { NextResponse } from "next/server";
import { COOKIE_NAME, cookieOptions, gateToken, passwordOk } from "@/lib/auth";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  let password = "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { password?: string };
    password = String(body.password || "");
  } else {
    const form = await request.formData();
    password = String(form.get("password") || "");
  }
  if (!passwordOk(password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, gateToken(), cookieOptions());
  return res;
}
