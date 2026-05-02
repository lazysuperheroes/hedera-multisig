# Lazy Superheroes (LSH) — Branding & Design Reference

> Vendored snapshot of the LSH umbrella branding spec for offline reference.
>
> **Canonical source:** https://docs.lazysuperheroes.com/docs/branding_guide
> **Vendored from:** `lazylotto-agent/docs/LSH-Branding-Reference.md` (sister repo)
> **Last synced:** 2026-05-01
>
> This file is the single source of truth for the visual identity of Lazy
> Superheroes products. It is shared across all LSH dApps (lazylotto-agent,
> hedera-multisig, etc.). If you change anything in the canonical source,
> re-vendor this snapshot.
>
> **Important for hedera-multisig:** Not every spec here applies to this
> product. See [`../.impeccable.md`](../.impeccable.md) "Brand Family"
> section for what we share with LSH (footer attribution, primary blue,
> status semantics, LAZY Gold reservation) and where we diverge
> intentionally (light-default, dual-register, no decorative gradients,
> no game typefaces).

---

## 1. Brand Mode

**Dark mode only.** The application forces dark mode via `next-themes`. All design tokens refer to the `.dark` variant in `globals.css`. Never produce LSH-branded output in light mode.

> **hedera-multisig deviation:** This dApp is light-default with an explicit
> dark/console mode toggle. The "dark mode only" rule applies to consumer-facing
> LSH products (lazylotto), not financial signing tools.

---

## 2. Brand Assets

| Asset | URL | Usage |
|---|---|---|
| Primary Logo (dark) | `https://docs.lazysuperheroes.com/logo.svg` | Dark backgrounds |
| Logo (light) | `https://docs.lazysuperheroes.com/logo-light.svg` | Light contexts (rare) |
| LAZY Token Icon | `https://docs.lazysuperheroes.com/lazy_token.png` | Token references |
| Favicon | `https://docs.lazysuperheroes.com/favicon.svg` | Small icon contexts |
| Farm Logo | `https://docs.lazysuperheroes.com/Logo20Farm.webp` | Lazy Farms feature |

---

## 3. Color System

Colors are defined as CSS custom properties (HSL) and consumed via Tailwind utilities.

### 3.1 Core Palette (Dark Mode)

| Token | Hex | Usage |
|---|---|---|
| `background` | `#09090b` | Page background |
| `foreground` | `#fafafa` | Primary text |
| `primary` | `#3b82f6` | CTA buttons |
| `secondary` | `#27272a` | Secondary surfaces |
| `muted-foreground` | `#a1a1aa` | Placeholder text |
| `destructive` | `#dc2626` | Error / delete actions |
| `ring` | `#3b82f6` | Focus ring |
| `border` | `#27272a` | Borders & inputs |

### 3.2 Status Colors

| State | Hex |
|---|---|
| Success | `#16a34a` |
| Warning | `#f59e0b` |
| Info | `#0ea5e9` |

### 3.3 Brand Color — LAZY Gold

| Token | HSL | Hex | Usage |
|---|---|---|---|
| `--brand` | `45 93% 47%` | `#e5a800` | Brand accents, LAZY token references |

LAZY Gold is the primary brand accent. Apply to LAZY token icons, the `.lazy-font` gradient, and any hero brand moments.

> **hedera-multisig deviation:** LAZY Gold is *reserved* and only appears in
> the "Made by Lazy Superheroes" footer attribution. We do not have a token
> and the gold is not ours.

### 3.4 Chart Colors

Five sequential chart colours (`chart-1` through `chart-5`) for data visualisations.

### 3.5 Sidebar Colors

| Token | Value |
|---|---|
| `sidebar-bg` | `#09090b` |
| `sidebar-fg` | `#a1a1aa` |
| `sidebar-primary` | `#fafafa` |
| `sidebar-accent` | `#27272a` |

---

## 4. Typography

### 4.1 Primary Fonts

| Font | CSS Var | Tailwind Class | Usage |
|---|---|---|---|
| **Heebo** | `--font-heebo` | `font-sans` | Body text — all UI elements |
| **Unbounded** | `--font-unbounded` | `font-unbounded` | Headings (H1–H6), card & dialog titles |

### 4.2 Decorative Fonts

| Font | CSS Class | Usage |
|---|---|---|
| **Press Start 2P** | `.zero-font` / `.zerox-font` / `.pixelszero-font` | Pixel-art NFT labels |
| **Love Ya Like A Sister** | `.burn-font` | Burn feature label |
| **Viga** | `.lazy-font` | LAZY brand text |
| **Orbitron** | `.mission-font` | Missions heading |
| **Merriweather** | `.article-content` | Blog/article body |
| **Courier New** | `.terminal` | Terminal-style code display |

> **hedera-multisig deviation:** Decorative typefaces are out of scope. This
> is a financial signing tool and game-energy fonts would feel costume-y.
> Treasury mode SHOULD adopt Heebo + Unbounded for family unity; console mode
> is free to choose a more terminal-aligned grotesque + monospace stack.

### 4.3 Text Scale

| Context | Tailwind | Size |
|---|---|---|
| Body (mobile) | `text-sm` | 14px |
| Body (sm+) | `text-lg` | 18px |
| Line height | `leading-[150%]` | 1.5× |

---

## 5. Decorative Text Gradients

| Label | Class | Effect |
|---|---|---|
| ZERO | `.zero-font` | Silver metallic |
| ZEROX | `.zerox-font` | Neon pink |
| PIXELS | `.pixelszero-font` | Pink → Purple |
| BURN | `.burn-font` | Fire effect |
| LAZY | `.lazy-font` | LAZY Gold (`#e5a800`) |
| MISSION | `.mission-font` | Cosmic purple |

> **hedera-multisig deviation:** Decorative gradients do not appear in this
> dApp. Gradient text is on our anti-pattern list.

---

## 6. Spacing & Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius` | `0.5rem` | Base border-radius |
| `rounded-lg` | `0.5rem` | Large elements |
| `rounded-md` | `0.375rem` | Inputs, medium elements |
| `rounded-sm` | `0.25rem` | Small elements |
| `rounded-xl` | `0.75rem` | Cards |

---

## 7. Button Variants

| Variant | Usage |
|---|---|
| `default` | Primary CTA |
| `destructive` | Delete / irreversible |
| `outline` | Secondary |
| `secondary` | Tertiary / neutral |
| `ghost` | Minimal chrome |
| `link` | Inline text |
| `gradient` | Hero CTAs (blue) |
| `gradientGreen` | Success-adjacent |
| `gradientCyan` | Info-adjacent |
| `gradientPink` | Neon / ZEROX feature |
| `gradientOutline` | Bordered gradient accent |

**Sizes:** `default` (h-9) · `sm` (h-8) · `lg` (h-10) · `icon` (h-9 × w-9)

> **hedera-multisig deviation:** `gradient*` variants do not appear in this
> dApp. Use `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`.

---

## 8. Component Patterns

### Cards
- Background: `#09090b`
- Border: `#27272a`
- Radius: `rounded-xl`
- Shadow: `shadow`
- Title font: **Unbounded**

### Inputs
- Border: `#27272a`
- Radius: `rounded-md`
- Focus ring: `#3b82f6` (blue)

### Dialogs / Modals
- Background: `#09090b` with `#27272a` border
- Radius: `sm:rounded-lg`
- Title font: **Unbounded**

### Custom Scrollbar
- Width: `8px`
- Track: `#09090b`
- Thumb: `#27272a`, `border-radius: 5px`
- Thumb hover: `#a1a1aa`

---

## 9. Animations

| Name | Duration | Easing | Usage |
|---|---|---|---|
| `accordion-down` | 0.2s | ease-out | Accordion expand |
| `accordion-up` | 0.2s | ease-out | Accordion collapse |
| `shimmer` | 1.5s | linear | Skeleton loaders |
| `flash` | 1s | alternate | Loading pulse |
| `typing` | 0.5s | steps(40) | Typewriter |

---

## 10. Social & SEO

| Property | Value |
|---|---|
| App Title | **Lazy dApp** |
| Meta Description | Lazy dApp platform offers user-friendly solutions for Lazy Superheroes holders to stake, farm, exchange NFTs on Hedera. |
| Twitter Handle | `@SuperheroesLazy` |
| Twitter Card | `summary_large_image` |
| OG Image | `https://lsh-cache.b-cdn.net/twitterHD.png` |

> **hedera-multisig deviation:** App title, meta, and OG image are
> product-specific (see `dapp/app/layout.tsx`). Twitter handle is shared.

---

## Quick Reference Card

```
Dark background   →  #09090b
Primary text      →  #fafafa
CTA / focus       →  #3b82f6  (blue)
Brand accent      →  #e5a800  (LAZY Gold)
Surfaces/borders  →  #27272a
Error/delete      →  #dc2626

Heading font      →  Unbounded
Body font         →  Heebo

Card radius       →  rounded-xl (0.75rem)
Input radius      →  rounded-md (0.375rem)
```
