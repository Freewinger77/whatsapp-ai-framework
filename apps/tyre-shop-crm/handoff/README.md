# Tyres 4 U · SMT CRM — dashboard handoff

Two static pages, no build step. Open either file directly in a browser.

    desktop.html        the console: 212px sidebar, 68px top bar, dashboard content
    mobile.html         two mobile screens: Overview and Needs calling back
    css/tokens.css      RapidScreen design tokens, copied verbatim from the design system
    assets/             the brand mark bitmap

## How it is built

- All styling is inline on the elements. The only stylesheet is `css/tokens.css`
  (CSS custom properties: colours, type, radii, spacing). Inline styles reference
  those variables, e.g. `var(--black-4)`, `var(--background-2)`, `var(--logo-2)`.
- Type is Inter 400/500/600 only. 14/20 is the default, 12/16 for meta,
  24 semibold for section numbers, 44 semibold for the three hero numbers.
- No shadows. Separation is a 1px hairline inset:
  `box-shadow: inset 0 0 0 1px var(--black-4)` for structure,
  `var(--black-10)` for interactive borders.
- Hover is a single `rgba(0,0,0,0.04)` wash on a 12px radius.
- Icons are inline SVG (Phosphor, from the design system's icon set), `currentColor`.
- Charts are inline SVG paths in a `0 0 640 160` viewBox with
  `preserveAspectRatio="none"` and `vector-effect="non-scaling-stroke"`, so they
  stretch to any card width with a constant 2px stroke. Swap the `d` attribute
  for real data; the curve is Catmull-Rom through 7 daily values.
- Layout is flex with `gap` and `flex: 1 1 <basis>`; rows wrap on their own,
  so there are no media queries.

## Mobile

`mobile.html` shows both screens side by side in 402x874 viewports (`.phone`).
In production each is just a page — drop the `.phone` wrapper and let the body
fill the viewport. The bottom tab bar is `position`-free: it is the last flex
child of a full-height column, with the scrolling content above it.

## Data

Real, from the SMT CRM and the bookings export (2026-09-05):
customers 275, email leads 80, phone leads 3, bookings 267 of 300 orders
(16 abandoned, 8 cancelled), NPS 71.43% from 28 responses, 5 leads in the week
(2 email, 3 phone, 60% after hours), 4 bookings created and 1 fitted,
lead to booked 6 of 70 unique people (8.6%), and the six people who booked.

Placeholder, needs the real enquiry feed: the five lead names, phone numbers and
timestamps in "Recent leads", the three rows in "Needs calling back", and the
"Last poll" time. One callback row deliberately has no caller ID and a disabled
WhatsApp button, because phone-channel home items often arrive without a number.
