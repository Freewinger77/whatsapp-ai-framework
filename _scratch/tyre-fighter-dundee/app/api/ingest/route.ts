import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const expected = process.env.DUNDEE_INGEST_SECRET;
  const provided = request.headers.get("x-dundee-ingest-secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "json object required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("dundee_ingest_message", {
    payload: { source: payload.source || "n8n", ...payload },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ success: true, data });
}
