# Lazy Superheroes — Sister Project Design Context

> Snapshot of the `lazylotto-agent` design context for cross-product
> reference. Not authoritative for hedera-multisig — see
> [`../.impeccable.md`](../.impeccable.md) for our own design context.
>
> **Vendored from:** `lazylotto-agent/.impeccable.md` (sister repo)
> **Last synced:** 2026-05-01
>
> Purpose: knowing what the sister product feels like helps us calibrate
> the "different but family" register for hedera-multisig — what to share,
> what to deliberately diverge on, and how to attribute LSH parentage
> without becoming a clone of our consumer-facing sibling.

---

## Design Context (lazylotto-agent)

### Users
**Mixed audience**: Crypto-native NFT collectors who want speed and power, coexisting with casual community members who joined for the art and narrative and are learning crypto as they go. The interface must serve both without patronizing newcomers or boring power users. Context: managing digital assets, playing games (lotto), staking NFTs, voting on governance — all within the LazyVerse ecosystem on Hedera.

### Brand Personality
**Playful, bold, community** — with undertones of **premium** and **trustworthy**. Lazy Superheroes is a character-based, narrative-driven art project spanning NFTs, comic books, merchandise, and games within the LazyVerse. The brand rewards collector loyalty, builds original IP with fleshed-out character personalities, and aims to be a club everyone wants to join. It builds decentralized web3 solutions for the Hedera network.

### Emotional Goals
- **User-facing flows** (lotto, minting, playing): Excitement, anticipation, thrill — the feeling of a game worth playing
- **Admin/financial flows** (withdrawals, pool management, role management): Confidence, control, clarity — no ambiguity about what's happening with funds
- **Throughout**: Trust. Users are handling real assets. The interface must never feel reckless or unclear about consequences.

### Aesthetic Direction
- **Tone**: Bold but not garish. Playful but not childish. Premium but not sterile.
- **Reference**: PoolTogether / Stake.us — clean crypto gaming with clear odds and transparent mechanics
- **Anti-reference**: Generic DeFi dashboards (Uniswap-style dense utilitarian). Also avoid: casino aesthetics, neon-on-dark "crypto bro" energy, overly serious enterprise feel
- **Theme**: Dark mode only (forced via next-themes, `#09090b` base). Brand gold (`#e5a800`, HSL `45 93% 47%`) for LAZY token identity. Blue primary (`#3b82f6`) for actions. Status colors for semantic meaning. See `LSH-Branding-Reference.md` for full token spec.
- **Typography**: Heebo (body) + Unbounded (headings). Press Start 2P and other decorative fonts for contextual character/game moments — used sparingly.
- **Icons**: Material Symbols Outlined — consistent, semantic, no emoji-as-icons in functional UI

### Design Principles

1. **Clarity over cleverness**: Every element should communicate its purpose instantly. Ambiguity in a financial interface erodes trust. Labels, states, and consequences must be unambiguous.

2. **Progressive disclosure**: Start simple, reveal complexity through interaction. New users see the essential path; power users discover depth. Admin functions are tucked behind access-gated sections, not cluttering the main experience.

3. **Earned excitement**: Animations and visual energy belong in game moments (lotto rolls, prize reveals, minting). Admin panels, financial operations, and pool management should be calm, clear, and deliberate. Don't make withdrawing funds feel like a slot machine.

4. **Consistent semantic color**: Success is green, warning is orange, destructive is red, info is cyan, brand is gold. These meanings are sacred — never use status colors decoratively. Tokenize everything through CSS variables.

5. **One primary action per context**: Every screen should have exactly one obvious thing to do next. Secondary actions exist but don't compete visually. The eye should land on the right button within 2 seconds.

---

## What hedera-multisig should take from this

- **Clarity over cleverness, semantic color, one primary action** — adopt verbatim. These are LSH-wide principles, not lazylotto-specific.
- **Progressive disclosure** — adopt; treasury operators want simple by default, advanced behind expand.
- **"Don't make withdrawing funds feel like a slot machine"** — this is *the entire job* of hedera-multisig; we are the calm-financial register that lazylotto opted out of by being a game.
- **Heebo + Unbounded** — adopt for treasury mode for family unity.
- **Material Symbols Outlined** — adopt; LSH-wide icon standard.
- **No emoji-as-icons** — adopt verbatim.

## What hedera-multisig should explicitly NOT take

- **Dark-mode-only**. We are light-default with a dark/dev mode toggle.
  Treasury operators don't want a forced dark UI.
- **Decorative gradients** (`.zero-font`, `.zerox-font`, `.lazy-font`, etc.).
  These are LSH game-energy decoration — costume-y in a financial signing
  context.
- **Press Start 2P, Viga, Orbitron, Love Ya Like A Sister, Merriweather**.
  Game/narrative typefaces. Out of scope here.
- **PoolTogether / Stake.us reference**. Their "crypto gaming with clear
  odds" frame doesn't apply to a multi-party signing tool. Our references
  are Stripe / Mercury / Linear (treasury mode) and Vercel / Railway /
  Resend (dev mode).
- **"Bold but not garish, playful but not childish"**. We are *calm-precise*
  in treasury mode and *sharp-technical* in dev mode. Playfulness is not
  in our register at all.
