import { mkdirSync, writeFileSync } from "node:fs";
import { LiveSmtClient } from "../lib/smt/client";

async function allPages<T>(
  label: string,
  fetchPage: (page: number) => Promise<{ items: T[]; hasMore: boolean }>,
) {
  const items: T[] = [];
  for (let page = 1; page <= 250; page += 1) {
    const result = await fetchPage(page);
    items.push(...result.items);
    console.log(label, "page", page, "got", result.items.length, "total", items.length);
    if (!result.hasMore) break;
  }
  return items;
}

async function main() {
  const client = new LiveSmtClient();
  await client.login();
  const ping = await client.ping();
  console.log("ping", ping);

  const customers = await allPages("customers", (p) => client.listCustomers(p, 20));
  const enquiries = await allPages("enquiries", (p) => client.listEnquiries(p, 20));
  const nps = await allPages("nps", (p) => client.listNps(p, 20));
  const testimonials = await allPages("testimonials", (p) => client.listTestimonials(p, 20));
  const csv = await client.exportCustomersCsv();
  const headline = await client.headlineNps();

  const out = {
    ping,
    headline,
    counts: {
      customers: customers.length,
      enquiries: enquiries.length,
      nps: nps.length,
      testimonials: testimonials.length,
      csv: csv.length,
    },
    customers,
    enquiries,
    nps,
    testimonials,
  };
  mkdirSync("/tmp/smt-live", { recursive: true });
  writeFileSync("/tmp/smt-live/export.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ping, headline, counts: out.counts }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
