import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLeadConversion, leadsInLondonWindow } from "./conversion";

describe("buildLeadConversion", () => {
  it("counts unique booked people when one person sent several email enquiries", () => {
    const result = buildLeadConversion(
      [
        {
          smt_id: "1",
          name: "Cameron Rice",
          phone: "07342658449",
          phone_e164: "+447342658449",
          email: "cameron12rice@gmail.com",
          channel: "email",
          enquired_at: "2026-06-25T10:00:00.000Z",
        },
        {
          smt_id: "2",
          name: "Cameron Rice",
          phone: "07342658449",
          phone_e164: "+447342658449",
          email: "cameron12rice@gmail.com",
          channel: "email",
          enquired_at: "2026-06-25T11:00:00.000Z",
        },
        {
          smt_id: "3",
          name: "Alison Crawley",
          phone: "07740677509",
          phone_e164: "+447740677509",
          email: "alcrawley77@gmail.com",
          channel: "email",
          enquired_at: "2026-09-04T16:02:00.000Z",
        },
        {
          smt_id: "phone-1",
          name: "Phone enquiry",
          phone: null,
          phone_e164: null,
          email: null,
          channel: "phone",
          enquired_at: "2026-09-05T09:25:00.000Z",
        },
      ],
      [
        {
          smt_id: "55405",
          name: "Cameron Rice",
          phone_e164: "+447342658449",
          email: "cameron12rice@gmail.com",
        },
      ],
    );
    assert.equal(result.emailLeadRows, 3);
    assert.equal(result.matchedRows, 2);
    assert.equal(result.uniqueBooked, 1);
    assert.equal(result.openRows, 1);
    assert.equal(result.people[0].enquiryCount, 2);
    assert.equal(result.people[0].customerSmtId, "55405");
  });

  it("windows email leads to the selected London days so the rate can move", () => {
    const now = new Date("2026-09-06T12:00:00+01:00");
    const leads = [
      {
        smt_id: "old",
        name: "Cameron Rice",
        phone: "07342658449",
        phone_e164: "+447342658449",
        email: "cameron12rice@gmail.com",
        channel: "email",
        enquired_at: "2026-06-25T10:00:00.000Z",
      },
      {
        smt_id: "week",
        name: "Alison Crawley",
        phone: "07740677509",
        phone_e164: "+447740677509",
        email: "alcrawley77@gmail.com",
        channel: "email",
        enquired_at: "2026-09-04T16:02:00.000Z",
      },
    ];
    const customers = [
      {
        smt_id: "55405",
        name: "Cameron Rice",
        phone_e164: "+447342658449",
        email: "cameron12rice@gmail.com",
      },
    ];
    const week = buildLeadConversion(leadsInLondonWindow(leads, 7, now), customers);
    const all = buildLeadConversion(leads, customers);
    assert.equal(week.emailLeadRows, 1);
    assert.equal(week.uniqueLeadPeople, 1);
    assert.equal(week.uniqueBooked, 0);
    assert.equal(week.peoplePct, 0);
    assert.equal(all.emailLeadRows, 2);
    assert.equal(all.uniqueBooked, 1);
    assert.notEqual(week.peoplePct, all.peoplePct);
  });
});
