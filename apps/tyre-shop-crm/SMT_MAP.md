# SMT admin map (Tyres 4 U)

Selectors were checked against the public login screenshot and unauthenticated URL probes. Authenticated list HTML is loaded on first live login; the client prefers the page’s own DataTables `ajax` URL, then HTML tables, then Customers CSV export.

## Login (screenshot verified)

- URL: https://admin.sellmoretyres.com/Account/Login
- Stack: IIS / ASP.NET MVC 5.2 / Silkmoth
- Form `POST /` fields: `Email`, `Password`, `RememberMe`, hidden `__RequestVerificationToken`
- Cookies after GET login: `ASP.NET_SessionId`, `__RequestVerificationToken`, `ARRAffinity`

## Confirmed routes (unauthenticated 302 → login = route exists)

| Path | Role |
|---|---|
| `/FittingCentre/CRM` | Hub: Customers / Enquiries / NPS / Testimonials |
| `/FittingCentre/CRM/Customers` | Paged customer list + quick search |
| `/FittingCentre/CRM/Customers/List` | List variant / likely XHR |
| `/FittingCentre/CRM/Customers/Export` | CSV of all customers (KB + route exists) |
| `/FittingCentre/CRM/Enquiries` | Enquiry list (New / Resolved) |
| `/FittingCentre/CRM/Enquiries/List` | List variant |
| `/FittingCentre/CRM/NPS` | Score, Date, Reason, Comment, View |
| `/FittingCentre/CRM/NPS/List` | List variant |
| `/FittingCentre/CRM/Testimonials` | Public quotes |
| `/FittingCentre/CRM/Testimonials/List` | List variant |
| `/FittingCentre/Reports` | Reports hub (reconcile) |
| `/FittingCentre/Reports/BrandsSold` | Brands report |

## Dedupe

- Customer: View `/Customers/View/:id` else phone E.164
- Enquiry: View `/Enquiries/View/:id`
- NPS: View id else hash(score + date + phone/name)
- Testimonial: View id else hash(name + quote + date)

## In-hours

Mon–Sat 09:00–17:00 `Europe/London`. Sunday and evenings = out of hours.

## Live login still needed

`SMT_EMAIL` / `SMT_PASSWORD` were not supplied in this pass. Set them in `.env.local` + Vercel, then:

1. Open CRM hub and screenshot each list + View drawer.
2. Confirm the DataTables ajax URL the page actually calls.
3. Open Reports and compare counts to `GET /api/analytics`.
