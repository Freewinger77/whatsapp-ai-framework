import { NextResponse } from "next/server";
import { cronAuthorized, isAuthed } from "./auth";

export async function requireSession(): Promise<NextResponse | null> {
  if (await isAuthed()) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function requireSessionOrCron(request: Request): Promise<NextResponse | null> {
  if (await isAuthed()) return null;
  if (cronAuthorized(request)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function asCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const body = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
