import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInHours } from "../hours";
import {
  activityFromHome,
  customersFromTable,
  enquiriesFromExportCsv,
  enquiriesFromTable,
  extractAntiforgery,
  extractHeadlineNps,
  npsFromTable,
  parseHtmlTables,
  parseSmtHomeClock,
  parseUkDate,
  phoneLeadsFromActivity,
} from "./parse";

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
    assert.equal(
      extractHeadlineNps(`<h3>Your NPS Score Is:</h3><p id="percentage">71.43%</p>`),
      71.43,
    );
  });
  it("uses View /id as the customer dedupe key and E.164 fallback", () => {
    const table = parseHtmlTables(CUSTOMERS)[0];
    const [row] = customersFromTable(table);
    assert.equal(row.smtId, "1001");
    assert.equal(row.phoneE164, "+447700900001");
  });
  it("reads First Name / Last Name / Contact number / CustomerView ids", () => {
    const html = `<table><tr><th>First Name</th><th>Last Name</th><th>Email</th><th>VRN</th><th>Contact number</th></tr>
      <tr><td>Samantha</td><td>Mcwilliams</td><td>a@b.com</td><td>DS11ENM</td><td>07921529747</td>
      <td><a href="/FittingCentre/CRM/CustomerView/74861">View</a></td></tr></table>`;
    const [row] = customersFromTable(parseHtmlTables(html)[0]);
    assert.equal(row.smtId, "74861");
    assert.equal(row.name, "Samantha Mcwilliams");
    assert.equal(row.phoneE164, "+447921529747");
  });
  it("flags weekday morning enquiries as in hours", () => {
    const table = parseHtmlTables(ENQUIRIES)[0];
    const [row] = enquiriesFromTable(table);
    assert.equal(row.smtId, "2001");
    assert.equal(row.inHours, true);
  });
  it("parses SMT UK datetimes as Europe/London wall clock", () => {
    // Friday 4 Sep 2026 is BST. 16:30 must stay in-hours; 17:02 is out.
    const lateAfternoon = parseUkDate("04/09/2026 16:30");
    const afterClose = parseUkDate("04/09/2026 17:02");
    assert.ok(lateAfternoon);
    assert.ok(afterClose);
    assert.equal(isInHours(lateAfternoon), true);
    assert.equal(isInHours(afterClose), false);
  });
  it("drops SMT pager footer rows so they are not customers or scores", () => {
    const html = `<table>
      <tr><th>First Name</th><th>Last Name</th><th>Email</th><th>VRN</th><th>Contact number</th></tr>
      <tr><td>Sam</td><td>Lee</td><td>a@b.com</td><td>AB12CDE</td><td>07700900001</td>
        <td><a href="/FittingCentre/CRM/CustomerView/1">View</a></td></tr>
      <tr><td colspan="8"><ul class="pager"><li>Page 1 of 14</li><li><a href="?page=2">Next &gt;</a></li></ul></td></tr>
    </table>`;
    const [row, ...rest] = customersFromTable(parseHtmlTables(html)[0]);
    assert.equal(rest.length, 0);
    assert.equal(row.smtId, "1");
    const npsHtml = `<table><tr><th>Score</th><th>Date</th></tr>
      <tr><td>10</td><td>04/09/2026</td><td><a href="/FittingCentre/CRM/NPSView?nps=9">View</a></td></tr>
      <tr><td colspan="8">Page 1 of 3 Next > >></td></tr></table>`;
    const nps = npsFromTable(parseHtmlTables(npsHtml)[0]);
    assert.equal(nps.length, 1);
    assert.equal(nps[0].score, 10);
  });
  it("marks CRM list rows as email leads with name and phone", () => {
    const [row] = enquiriesFromTable(parseHtmlTables(ENQUIRIES)[0]);
    assert.equal(row.channel, "email");
    assert.equal(row.phoneE164, "+447700900011");
    assert.equal(row.name, "Liam Scott");
  });
  it("reads SMT home Phone Enquiry Received vs Enquiry Received", () => {
    const html = `<section class="recent-activity"><ul>
      <li><span class="fa fa-phone icon"></span><h4>Phone Enquiry Received</h4>
        <span class="time">at <strong>10:25 AM</strong> on <strong>05 Sep 2026</strong></span></li>
      <li><span class="fa fa-envelope icon"></span><h4>Enquiry Received</h4>
        <span class="time">at <strong>5:02 PM</strong> on <strong>04 Sep 2026</strong></span>
        <a href="/FittingCentre/CRM/EnquiriesView/110103">Reply to Customer</a></li>
      <li><span class="fa fa-phone icon"></span><h4>Phone Enquiry Received</h4>
        <span class="time">at <strong>12:28 PM</strong> on <strong>04 Sep 2026</strong></span></li>
      <li><span class="fa fa-phone icon"></span><h4>Phone Enquiry Received</h4>
        <span class="time">at <strong>12:28 PM</strong> on <strong>04 Sep 2026</strong></span></li>
    </ul></section>`;
    const items = activityFromHome(html);
    assert.equal(items.filter((i) => i.kind === "phone_enquiry").length, 2);
    assert.equal(items.find((i) => i.kind === "email_enquiry")?.viewId, "110103");
    const phone = phoneLeadsFromActivity(items);
    assert.equal(phone.length, 2);
    assert.equal(phone[0].channel, "phone");
    assert.equal(phone[0].name, "Phone enquiry");
    assert.equal(isInHours(parseSmtHomeClock("10:25 AM", "05 Sep 2026")), true);
    assert.equal(isInHours(parseSmtHomeClock("5:02 PM", "04 Sep 2026")), false);
  });
  it("reads enquiry export CSV message and phone", () => {
    const csv = `Name,Email,Phone,Message,Notes,Date Created,Tags
Alison Crawley,alcrawley77@gmail.com,07740677509,Hello screw in tyre,,04/09/2026,`;
    const [row] = enquiriesFromExportCsv(csv);
    assert.equal(row.name, "Alison Crawley");
    assert.equal(row.phoneE164, "+447740677509");
    assert.match(row.message || "", /screw in tyre/);
    assert.equal(row.channel, "email");
  });
  it("keeps NPS Score / Date / Reason / Comment columns from the screenshot", () => {
    const table = parseHtmlTables(NPS)[0];
    const [row] = npsFromTable(table);
    assert.equal(row.smtId, "3001");
    assert.equal(row.score, 10);
    assert.equal(row.reason, "Fast fitting");
  });
});
