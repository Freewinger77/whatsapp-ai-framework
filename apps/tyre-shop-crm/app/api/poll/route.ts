import { NextResponse } from "next/server";
import { requireSessionOrCron } from "@/lib/api";
import { tick } from "@/lib/poller";

async function run(request: Request) {
  const denied = await requireSessionOrCron(request);
  if (denied) return denied;
  let announce: boolean | undefined;
  let fullExport = false;
  if (request.method === "POST") {
    try {
      const body = (await request.json()) as { announce?: boolean; fullExport?: boolean };
      if (typeof body.announce === "boolean") announce = body.announce;
      fullExport = Boolean(body.fullExport);
    } catch {
      /* empty body */
    }
  }
  const result = await tick({ announce, fullExport });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export const GET = run;
export const POST = run;
