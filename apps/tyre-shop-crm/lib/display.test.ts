import assert from "node:assert/strict";
import test from "node:test";
import { formatUkPhone, leadDisplayName, listPages, whatsappHref } from "./display";

test("formats UK mobiles the way the handoff shows them", () => {
  assert.equal(formatUkPhone("07701448992"), "07701 448992");
  assert.equal(formatUkPhone("+447701448992"), "07701 448992");
});

test("whatsapp href uses 44 without plus", () => {
  assert.equal(whatsappHref("07701 448992"), "https://wa.me/447701448992");
  assert.equal(whatsappHref(null), null);
});

test("missing caller names become No caller ID", () => {
  assert.deepEqual(leadDisplayName(""), { text: "No caller ID", missing: true });
  assert.deepEqual(leadDisplayName("Chloe Aitken"), { text: "Chloe Aitken", missing: false });
});

test("list pages match SMT pager math used in the handoff", () => {
  assert.equal(listPages(275, 20), 14);
  assert.equal(listPages(80, 20), 4);
  assert.equal(listPages(28, 10), 3);
});
