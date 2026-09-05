import { isInHours } from "../hours";
import { toE164 } from "../phone";
import type { ListPage, SmtClient, SmtCustomer, SmtEnquiry, SmtNps, SmtPing, SmtTestimonial } from "./types";

function pageOf<T>(items: T[], page: number, pageSize: number, url: string): ListPage<T> {
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    items: slice,
    page,
    pageSize,
    total: items.length,
    hasMore: start + pageSize < items.length,
    source: "mock",
    url,
  };
}

const CUSTOMERS: SmtCustomer[] = [
  ["1001", "Amira Khan", "amira@example.com", "07700900001", "DD1 1AA", "Website", "Active", "2026-08-12T10:00:00Z"],
  ["1002", "James Reid", "james@example.com", "07700900002", "DD2 2BB", "Walk-in", "Active", "2026-07-01T09:30:00Z"],
  ["1003", "Priya Shah", "priya@example.com", "07700900003", "DD3 3CC", "Phone", "Active", "2026-08-20T14:00:00Z"],
  ["1004", "Callum Brown", "callum@example.com", "07700900004", "DD4 4DD", "Website", "Lapsed", "2025-11-02T11:00:00Z"],
  ["1005", "Hannah Wu", "hannah@example.com", "07700900005", "DD5 5EE", "Google", "Active", "2026-09-01T16:20:00Z"],
  ["1006", "Owen Fraser", "owen@example.com", "07700900006", "PH1 1FF", "Website", "Active", null],
].map(([smtId, name, email, phone, postcode, source, stage, lastBookingAt]) => {
  const [firstName, ...rest] = String(name).split(" ");
  return {
    smtId: String(smtId),
    name: String(name),
    firstName,
    lastName: rest.join(" "),
    email: String(email),
    phone: String(phone),
    phoneE164: toE164(String(phone)),
    postcode: String(postcode),
    source: String(source),
    stage: String(stage),
    lastBookingAt: lastBookingAt ? String(lastBookingAt) : null,
    raw: { id: smtId, name },
  };
});

function enquiry(
  smtId: string,
  name: string,
  phone: string,
  at: string,
  status: string,
): SmtEnquiry {
  return {
    smtId,
    customerSmtId: null,
    name,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    phone,
    phoneE164: toE164(phone),
    status,
    source: "Enquiry Received",
    notes: null,
    channel: "email",
    message: null,
    tags: null,
    enquiredAt: at,
    inHours: isInHours(at),
    raw: { id: smtId },
  };
}

const ENQUIRIES: SmtEnquiry[] = [
  enquiry("2001", "Liam Scott", "07700900011", "2026-09-04T09:20:00+01:00", "New Enquiry"),
  enquiry("2002", "Sofia Patel", "07700900012", "2026-09-04T18:40:00+01:00", "New Enquiry"),
  enquiry("2003", "Noah Campbell", "07700900013", "2026-09-03T12:05:00+01:00", "Resolved Enquiry"),
  enquiry("2004", "Mia Chen", "07700900014", "2026-08-31T10:15:00+01:00", "New Enquiry"),
  enquiry("2005", "Jack Wilson", "07700900015", "2026-08-30T20:10:00+01:00", "New Enquiry"),
  enquiry("2006", "Ella Brooks", "07700900016", "2026-08-29T16:55:00+01:00", "Resolved Enquiry"),
  enquiry("2007", "Sunday Caller", "07700900017", "2026-08-30T11:00:00+01:00", "New Enquiry"),
];

const NPS: SmtNps[] = [
  { smtId: "3001", score: 10, reason: "Fast fitting", comment: "On time", name: "Amira Khan", phone: "07700900001", phoneE164: toE164("07700900001"), scoredAt: "2026-08-12T11:00:00Z", raw: {} },
  { smtId: "3002", score: 9, reason: "Price", comment: "Good value", name: "James Reid", phone: "07700900002", phoneE164: toE164("07700900002"), scoredAt: "2026-07-02T11:00:00Z", raw: {} },
  { smtId: "3003", score: 8, reason: "Service", comment: null, name: "Priya Shah", phone: "07700900003", phoneE164: toE164("07700900003"), scoredAt: "2026-08-21T11:00:00Z", raw: {} },
  { smtId: "3004", score: 10, reason: "Staff", comment: "Helpful", name: "Hannah Wu", phone: "07700900005", phoneE164: toE164("07700900005"), scoredAt: "2026-09-01T17:00:00Z", raw: {} },
  { smtId: "3005", score: 4, reason: "Wait", comment: "Ran late", name: "Callum Brown", phone: "07700900004", phoneE164: toE164("07700900004"), scoredAt: "2025-11-03T11:00:00Z", raw: {} },
  { smtId: "3006", score: 9, reason: "Location", comment: null, name: "Owen Fraser", phone: "07700900006", phoneE164: toE164("07700900006"), scoredAt: "2026-06-10T11:00:00Z", raw: {} },
  { smtId: "3007", score: 10, reason: "Recommend", comment: "Will be back", name: "Liam Scott", phone: "07700900011", phoneE164: toE164("07700900011"), scoredAt: "2026-09-04T15:00:00Z", raw: {} },
];

const TESTIMONIALS: SmtTestimonial[] = [
  { smtId: "4001", name: "Amira Khan", quote: "Fitted four tyres before lunch. Straight talk, fair price.", publishedAt: "2026-08-13T09:00:00Z", raw: {} },
  { smtId: "4002", name: "Hannah Wu", quote: "Booked online, in and out in 40 minutes.", publishedAt: "2026-09-02T09:00:00Z", raw: {} },
  { smtId: "4003", name: "James Reid", quote: "Would use Tyres 4 U again.", publishedAt: "2026-07-04T09:00:00Z", raw: {} },
];

export function createMockClient(): SmtClient {
  return {
    async login() {},
    async ensureSession() {},
    async ping(): Promise<SmtPing> {
      return { ok: true, detail: "mock", headlineNps: 71.43 };
    },
    async listCustomers(page = 1, pageSize = 50) {
      return pageOf(CUSTOMERS, page, pageSize, "/mock/customers");
    },
    async listEnquiries(page = 1, pageSize = 50) {
      return pageOf(ENQUIRIES, page, pageSize, "/mock/enquiries");
    },
    async listNps(page = 1, pageSize = 50) {
      return pageOf(NPS, page, pageSize, "/mock/nps");
    },
    async listTestimonials(page = 1, pageSize = 50) {
      return pageOf(TESTIMONIALS, page, pageSize, "/mock/testimonials");
    },
    async exportCustomersCsv() {
      return CUSTOMERS;
    },
    async exportEnquiriesCsv() {
      return ENQUIRIES;
    },
    async listHomeActivity() {
      return [
        {
          kind: "phone_enquiry" as const,
          title: "Phone Enquiry Received",
          at: "2026-09-05T09:25:00.000Z",
          href: null,
          viewId: null,
        },
        {
          kind: "email_enquiry" as const,
          title: "Enquiry Received",
          at: "2026-09-04T16:02:00.000Z",
          href: "/FittingCentre/CRM/EnquiriesView/2002",
          viewId: "2002",
        },
      ];
    },
    async headlineNps() {
      return 71.43;
    },
  };
}
