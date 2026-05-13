# Design System Strategy: The Command Sanctuary

## 1. Overview & Creative North Star
The vision for this design system is **"The Command Sanctuary."** In the high-stakes world of API management and enterprise communication, the interface must provide a sense of absolute control and calm. We are moving away from the "cluttered dashboard" trope and toward a high-end editorial experience.

This system rejects the "boxed-in" aesthetic of traditional SaaS. Instead, it utilizes **Tonal Intelligence**: a method of defining structure through light and depth rather than rigid lines. By leveraging intentional asymmetry, expansive negative space, and a sophisticated dark-mode palette, we create an environment that feels more like a premium studio tool than a generic management portal.

## 2. Colors: The Depth of Shadows
Our palette is rooted in a "Deep Space" architecture. We use `surface` as our foundation and build upward using light, not lines.

### The "No-Line" Rule
**Designers are prohibited from using 1px solid borders to section off major layout areas.** 
Structural boundaries must be defined through background color shifts. For example, a sidebar should use `surface-container-low` against the `surface` main content area. If a card needs to stand out, use `surface-container-highest` to create a natural, "physical" lift.

### Surface Hierarchy & Nesting
Treat the UI as a series of nested physical layers:
*   **Base Layer:** `surface` (#111417) — The infinite canvas.
*   **Secondary Layer:** `surface-container` (#1d2023) — Layout wrappers and navigation panels.
*   **Active Layer:** `surface-container-high` (#272a2e) — Individual cards and interactive modules.

### The "Glass & Gradient" Rule
To elevate the experience, floating elements (modals, dropdowns) should utilize **Glassmorphism**. Apply a semi-transparent `surface-container-highest` with a `20px` backdrop-blur. 

### Signature Textures
Main CTAs should never be flat. Use a subtle linear gradient (135°) from `primary` (#59dcb5) to `primary-container` (#00a884). This "WhatsApp Glow" provides a visual soul and tactile quality that flat colors lack.

## 3. Typography: Precision & Authority
We utilize a dual-font strategy to balance editorial elegance with technical precision.

*   **Display & Headlines (Manrope):** This is our "Editorial" voice. Manrope’s geometric yet warm curves provide an authoritative, high-end feel. Use `display-lg` for dashboard overviews and `headline-sm` for card titles.
*   **Body & Labels (Inter):** This is our "Functional" voice. Inter is designed for readability in data-heavy environments. Use `body-md` for general content and `label-sm` (all-caps with +5% tracking) for metadata and section headers.

**Hierarchy Note:** Use high contrast in scale rather than weight. A `display-md` headline paired with a `body-sm` description creates a modern, spacious look that guides the eye naturally.

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are often messy. In this system, depth is achieved through **Tonal Layering**.

### The Layering Principle
Instead of a shadow, place a `surface-container-lowest` (#0b0e11) input field inside a `surface-container-high` (#272a2e) card. This creates a "recessed" look that feels premium and intentional.

### Ambient Shadows
For floating elements (like toast notifications), use an **Ambient Shadow**:
*   **Color:** `on-surface` (#e1e2e7) at 6% opacity.
*   **Blur:** 48px.
*   **Y-Offset:** 16px.
*   *Why:* This mimics natural light dispersion in a dark room, avoiding the "dirty" look of black shadows on dark backgrounds.

### The "Ghost Border" Fallback
If an element lacks contrast against its background, use a **Ghost Border**: 
*   **Token:** `outline-variant` (#3d4a44) at 15% opacity.
*   **Constraint:** Never use 100% opacity for borders; it breaks the "Sanctuary" feel.

## 5. Components: Refined Interaction

### Buttons
*   **Primary:** Gradient from `primary` to `primary-container`. Corner radius `lg` (0.5rem). Text should be `on-primary-fixed` for maximum contrast.
*   **Secondary:** `surface-container-highest` background with a `Ghost Border`.
*   **Tertiary:** Transparent background with `primary` text. Use for low-priority actions like "Cancel" or "Learn More."

### Input Fields
*   **Style:** Background `surface-container-lowest`. Corner radius `md` (0.375rem).
*   **Focus State:** A 2px "Glow" using `primary` at 30% opacity, rather than a solid border.
*   **Error State:** Use `error` (#ffb4ab) for text and icon, with a subtle `error_container` background tint.

### Cards & Lists
*   **Forbid Dividers:** Do not use lines to separate list items. Use the `spacing-4` (1rem) token to create clear gutters, or use alternating `surface` and `surface-container-low` background tints for rows.
*   **Card Padding:** Standardize on `spacing-6` (1.5rem) for internal card padding to ensure "The Command Sanctuary" feels breathable.

### Custom Component: The Connection Status Blade
A unique component for this system. Use a horizontal "blade" with a `surface-container-highest` background and a `primary` glow on the left edge to indicate an active WhatsApp API connection. It should feel like a status light on a piece of high-end hardware.

## 6. Do's and Don'ts

### Do
*   **Do** use `spacing-12` and `spacing-16` for section margins. Breathing room is a luxury; use it.
*   **Do** use `primary` sparingly. It is a high-energy color; use it only for the most important action on the screen.
*   **Do** ensure all icons use a consistent stroke weight (1.5px or 2px) to match the Inter typography.

### Don't
*   **Don't** use pure black (#000000). It kills the tonal depth of the system. Stick to `surface` (#111417).
*   **Don't** use "Standard" Material shadows. They are too heavy for this high-end aesthetic.
*   **Don't** cram multiple primary buttons into one view. One "Primary Action" per viewport is the rule of the Sanctuary.
*   **Don't** use 100% opaque borders for card containers. If a border is needed, it must be a "Ghost Border."