import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customersFromTable,
  enquiriesFromTable,
  extractAntiforgery,
  extractHeadlineNps,
  npsFromTable,
  parseHtmlTables,
} from "./parse.ts";

const LOGIN = `<input name="__RequestVerificationToken" type="hidden" value="abcTOKEN" />`;

const NPS = `
<table>
  <thead><tr><th>Score</th><th>Date</th><th>Reason</th><th>Comment</th><th>View</th></tr></thead>
  <tbody>
    <tr>
      <td>10</td><td>12/08/2026</td><td>Fast fitting</td><td>On time</td>
      <td><a href="/FittingCentre/CRM/NPS/View/3001">View</a></td>
    </tr>
  </tbody>
</table>
<p>Your NPS Score Is: 71.43%</p>
`;

const CUSTOMERS = `
<table>
  <tr><th>Name</th><th>Email</th><th>Phone</th><th>Postcode</th></tr>
  <tr>
    <td>Amira Khan</td><td>amira@example.com</td><td>07700900001</td><td>DD1 1AA</td>
    <td><a href="/FittingCentre/CRM/Customers/View/1001">View</a></td>
  </tr>
</table>
`;

const ENQUIRIES = `
<table>
  <tr><th>Name</th><th>Phone</th><th>Status</th><th>Date</th></tr>
  <tr>
    <td>Liam Scott</td><td>07700900011</td><td>New Enquiry</td><td>04/09/2026 09:20</td>
    <td><a href="/FittingCentre/CRM/Enquiries/View/2001">View</a></td>
  </tr>
</table>
`;

describe("SMT HTML parse", () => {
  it("reads the antiforgery token from the login form", () => {
    assert.equal(extractAntiforgery(LOGIN), "abcTOKEN");
  });
  it("reads the NPS headline used for Reports reconcile", () => {
    assert.equal(extractHeadlineNps(NPS), 71.43);
  });
  it("uses View /id as the customer dedupe key and E.164 fallback", () => {
    const table = parseHtmlTables(CUSTOMERS)[0];
    const [row] = customersFromTable(table);
    assert.equal(row.smtId, "1001");
    assert.equal(row.phoneE164, "+447700900001");
  });
  it("flags weekday morning enquiries as in hours", () => {
    const table = parseHtmlTables(ENQUIRIES)[0];
    const [row] = enquiriesFromTable(table);
    assert.equal(row.smtId, "2001");
    assert.equal(row.inHours, true);
  });
  it("keeps NPS Score / Date / Reason / Comment columns from the screenshot", () => {
    const table = parseHtmlTables(NPS)[0];
    const [row] = npsFromTable(table);
    assert.equal(row.smtId, "3001");
    assert.equal(row.score, 10);
    assert.equal(row.reason, "Fast fitting");
  });
});
