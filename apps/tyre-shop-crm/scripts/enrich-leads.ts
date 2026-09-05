import { tick } from "../lib/poller";

async function main() {
  const result = await tick({
    announce: false,
    kinds: ["enquiries"],
    fullExport: true,
    maxPages: 20,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
