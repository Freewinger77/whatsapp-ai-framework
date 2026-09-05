# SMT admin map (Tyres 4 U)

Shop: **Tyres 4 U**, fitting centre **458**, site `dundeetyres4u.co.uk`. IIS / ASP.NET MVC 5.2 / Silkmoth.

## Login

- URL: https://admin.sellmoretyres.com/Account/Login
- Form `POST /` fields: `Email`, `Password`, `RememberMe`, hidden `__RequestVerificationToken`
- Cookies after GET login: `ASP.NET_SessionId`, `__RequestVerificationToken`, `ARRAffinity`

## Lists (live, 2026-09-05)

Lists are **server-rendered HTML** with `?page=N`. There is **no DataTables XHR**. Prefer the HTML walk over CSV.

| Path | Columns / notes | Census |
|---|---|---|
| `/FittingCentre/CRM/Customers` | First Name, Last Name, Email, VRN, Contact number. View `/CRM/CustomerView/:id`. Export `POST /FittingCentre/CRM/Export` (275 rows, no SMT ids). Each list table ends with a pager `<tr><td colspan>` — skip it. | **Page 1 of 14 → 275** View ids (CSV count matches) |
| `/FittingCentre/CRM/Enquiries` | Date submitted, Name, Email, Telephone, Status (New / Resolved). View `/CRM/EnquiriesView/:id`. Same pager footer. These are **email / form leads**, not booked customers. Export `GET/POST /CRM/ExportEnquiries` has Name, Email, Phone, Message, Notes, Date, Tags. | **Page 1 of 4 → 80** |
| `/FittingCentre/CRM/NPS` | Score, Date, Reason, Comment. View `/CRM/NPSView?nps=:id`. Headline `<h3>Your NPS Score Is:</h3><p id="percentage">71.43%</p>`. Pager text like `Page 1 of 3` must not be parsed as score `13`. | **Page 1 of 3 → 28** scores |
| `/FittingCentre/CRM/Testimonials` | Testimonial By, Date created, Approved, Comment. View `/CRM/Testimonial?TestimonialID=:id` | **5** |

Customers CSV is a useful **count check** (275) but has no View ids — do not upsert it.

## NPS headline vs table math

- SMT chrome: **71.43%**
- After dropping pager-as-score fakes (13 / 23 / 33 from `Page X of 3`): 22 promoters, 4 passive, 2 detractors on **28** rows → **71.43%**. Matches the headline.

## Reports (not the CRM census)

Hub: `/FittingCentre/Reports`

| Path | What it actually is |
|---|---|
| `/Reports/NewCustomers` | **New customer bookings** chart. Monthly Sep 2025–Sep 2026 sums to **243**, not 289 CRM customers |
| `/Reports/ExistingCustomers` | Existing customer **bookings** |
| `/Reports/BookingAverageTotals` | Average booking value |
| `/Reports/BookingTotals` | Total booking value |
| `/Reports/BrandsSold` | Brands sold |
| `/Reports/ViewTyreBookings` | Tyre bookings |

Reconcile dashboard KPIs against the CRM list pages (289 / 84 / 31 / 6), not these booking charts.

## Leads vs customers

SMT home **Recent Activity** shows two enquiry kinds:

- `Phone Enquiry Received` (`fa-phone`) — usually **no Reply / View link** and no caller ID in admin.
- `Enquiry Received` (`fa-envelope`) — `Reply to Customer` → `/CRM/EnquiriesView/:id` with name, email, telephone, message.

Treat both as **leads**. Do not mix them into `smt_customers`. Dashboard KPIs: Customers (booked list) vs Email leads vs Phone leads.

## In-hours

Mon–Sat 09:00–17:00 `Europe/London`. Sunday and evenings = out of hours. SMT `dd/mm/yyyy HH:mm` is parsed as London wall clock (BST/GMT), not UTC.

Example: Alison Crawley `04/09/2026 17:02` → out of hours.

## Dedupe

- Customer: `CustomerView/:id` (never phone unless the View href is missing)
- Enquiry: `EnquiriesView/:id`
- NPS: `NPSView?nps=:id` else hash(score + date + reason + comment)
- Testimonial: `TestimonialID=` else hash(name + quote + date)

Unknown id → insert + optional webhook. Known id → refresh, no second webhook.
