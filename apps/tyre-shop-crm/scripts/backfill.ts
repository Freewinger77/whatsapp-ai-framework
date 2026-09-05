import { tick } from "../lib/poller";

const result = await tick({
  announce: false,
  fullExport: true,
  maxPages: Number(process.env.BACKFILL_MAX_PAGES || 200),
  pageSize: Number(process.env.BACKFILL_PAGE_SIZE || 100),
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
