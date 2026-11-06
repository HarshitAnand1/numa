# numa — Figma / Figma Make design prompt (v2)

Owner: Member 3 (frontend). This is the prompt used to generate the visual design of `apps/web`. v2 folds in the first review round: smaller hero headline, no overlaps, a much more visible "numa" wordmark, refined palette, and real (not static) animation.

Visual reference system: mew.xyz (palette logic, display type attitude, motion language only; none of its assets, characters, logo or copy are used).
Fonts used in code are free stand-ins: Unbounded (display), Inter Tight (body), JetBrains Mono (mono), Rubik Spray Paint (stamps).

---

````
ROLE
You are a senior product designer + brand designer + motion designer + front-end engineer. Design AND build the complete end-to-end UI/UX for "numa" as a published, interactive site with REAL working animations (CSS/JS or Motion libraries, not only prototype frames). Aim for award-level craft (Awwwards / FWA caliber). Everything must feel human-made, opinionated and specific. It must NOT look AI-generated.

=====================================================
1. PRODUCT (design for these real mechanics; do not invent features)
=====================================================
numa = drop-in USDT checkout + creator marketplace on Whitechain Sepolia (testnet, chain 1874).
Tagline: "Pay creators only when a real sale settles. Fake clicks earn $0."
Core truth: a conversion = a real USDT payment that settled on-chain. No clicks, no impressions, no Stripe, no oracle.
One payment splits into: Merchant net (paid instantly) / Creator commission (HELD during a refund window, released later) / Protocol fee (max 1%). Commission max 50%.
Buyer pays gasless: signs one USDT authorization, a relayer pays gas, the buyer never needs WBT.
Creators, campaigns, offers, decisions, links, profiles, invites and endorsements live as wallet-owned Arkiv entities (a separate chain that needs tGLM for gas on writes). Money lives only on Whitechain.
Personas: Merchant, Creator, Buyer, Judge/Verifier (inspects txs and entities).

=====================================================
2. ART DIRECTION: "street-poster anti-fraud"
=====================================================
Reference system (extracted from mew.xyz; borrow the SYSTEM, never its assets, characters, logo or copy):
- Pure-black base, off-white inversion sections, two loud signal colors.
- Very wide heavy extended display type, plain neo-grotesque body, one hand-sprayed/stencil accent face.
- Motion: expo-out easing, long smooth reveals, infinite marquees in opposite directions, split-letter headings, slow alternating ambient pan, hamburger lines that slide away, full-screen menu.
- Tone: rebellious, lowercase manifesto voice, dry humor.
Numa's own twist: the enemy is BOT TRAFFIC. Visual language = bot-noise vs real-money signal.
Red = fake / refund / danger. Acid green = real, settled, earned. Never decorative.

ANTI-"AI LOOK" RULES (strict)
- NO purple/blue/pink gradients, NO glassmorphism, NO blurry blobs, NO generic 3D crypto coins/shields/cubes, NO isometric illustrations, NO emoji as icons, NO "Revolutionizing the future of..." copy, NO symmetric three-feature-card rows, NO centered hero + subtitle + two buttons template, NO lorem ipsum, NO identical rounded cards everywhere, NO sparkle icons.
- DO: big type, rotated stamps, hard 1px rules, section numbers (01, 02...), small mono captions, asymmetric 12-col layouts, deliberate overlaps that never hurt readability, halftone / photocopy / scanner-noise texture, tape and sticker details, ticket/receipt motifs (the receipt is the hero artifact), mono for hashes, real plausible data.
- Illustration: grainy photocopy-style cutouts and stamps. A recurring symbol system: a "bot cursor" (pixel arrow swarm) vs a "real hand" cursor.
- Icons: custom 1.5px stroke, slightly irregular terminals.

=====================================================
3. BRAND: THE NAME "numa" MUST BE VERY VISIBLE
=====================================================
- Wordmark: "numa" in the heavy display face, lowercase, with a spray-cut "u" in acid green. Also design a compact monogram, favicon and app icon set.
- Nav wordmark about 44px tall, heavy, always visible.
- Hero eyebrow: "NUMA / DROP-IN USDT CHECKOUT".
- Hero background: a giant outlined "numa" (1.5px Bone at 12% opacity), roughly 40vw tall, bleeding off the bottom edge, slow parallax on scroll.
- Intro loader: black screen, the numa wordmark draws in letter by letter, then the page reveals (1.2s).
- The numa stamp appears on receipts, tickets, buyer checkout, footer and OG images.
- Footer: the wordmark at full page width, cropped by the bottom edge.

=====================================================
4. DESIGN TOKENS (Figma Variables, light + dark modes)
=====================================================
Color (dark is default)
 Base #0A0A0B (loader and footer #000000) · Panel #121214 · Raised #1A1A1C
 Bone (text and inverse sections) #ECE8E1 (warm, never pure white) · Grey #9CA3AF
 Alarm Red #FF2A1F (bots / refund / danger / the $0 stamp)
 Acid Green #39FF14 (real money / settled / earned). Full strength ONLY on small elements: numbers, dots, stamps, rings. Tint surfaces use green at 12%.
 Pink #F5B8D4 (editorial accent, max one use per screen)
 Warning amber #FFB800 · Info Bone at 60% · Unverified = grey dashed outline.
 Lines: Bone at 14%. Focus ring: 2px green + 2px black offset.
 Top testnet banner: thin 28px black bar, 1px green bottom border, green mono text. NOT a full green bar.
 Check WCAG AA for all text pairs and annotate failures.
Type (free stand-ins; note licensed originals)
 Display: Unbounded Black or Dela Gothic One (stand-in for Heavitas), caps, tracking -3%.
 Body: Inter Tight or Helvetica Neue Roman 14/16/18, 140% line height.
 Accent stamp: stencil/spray face (Rubik Spray Paint / Rubik Wet Paint) for "SETTLED", "$0", "BOT", "VERIFIED".
 Mono: JetBrains Mono for addresses, hashes, amounts, captions.
 Hero headline is FLUID: clamp(48px, 8.2vw, 128px) desktop, 44px mobile, line-height 0.88. Section titles clamp(40px, 6vw, 96px). Never so large that it overflows or gets cut off.
Grid and spacing: 8px scale. Desktop 1440: 12 cols, 24 gutter, 64 side margin. Tablet 834: 8 cols. Mobile 390: 4 cols, 16 margin. Section padding 120 / 80 / 56.
Radius: 0, 4, pill. Borders 1px. No soft shadows; use a hard offset shadow (4px 4px 0 green or red) for pressed/primary states.
Texture: animated film grain 5% at 8fps, halftone dots, photocopy noise on stamp edges.

=====================================================
5. INFORMATION ARCHITECTURE AND ROUTES
=====================================================
Public: / · /how-it-works · /campaigns · /campaigns/[id] · /creators · /creators/[address] (creator card) · /leaderboard · /verify (paste tx hash or order id)
Creator app: /creator · /creator/discover · /creator/offers · /creator/links · /creator/invites · /creator/earnings · /creator/profile
Merchant app: /merchant · /merchant/campaigns/new · /merchant/campaigns/[id] · /merchant/creators · /merchant/invites · /merchant/orders · /merchant/settings
Buyer: /pay/[code] · /receipt/[txHash]
Embed: <NumaCheckout> widget (modal + inline + compact) used in /demo-shop, a fictional store with its OWN brand.
System: 404, 500, offline, maintenance, wrong-network, wallet-not-installed, testnet banner.
Global nav: large wordmark left; links "how it works / campaigns / leaderboard / verify a sale"; a segmented control labeled "MERCHANT | CREATOR" with a sliding highlight (NOT "M | C"); network pill "Whitechain . 1874"; wallet button. Mobile: hamburger + full-screen menu.

=====================================================
6. DATA THE UI MUST DISPLAY (real fields)
=====================================================
Campaign: id, name, description, category, region, commissionBps (show %), endsAt (countdown), status Active/Paused/Ended, offerCount (trending), merchantVerified with THREE badge states: Verified check, Unverified warning, "Unchecked" dashed (unknown).
Creator profile: address (short + copy + explorer link), niche tags, channel, minAskBps, open-for-work toggle.
Reputation: score 0-100 OR null (label "No verified sales history yet."), verifiedConversions, distinctPayers, grossSettled, commissionEarned. A "how this is calculated" popover in plain words with the honest limit: "does not prove audience authenticity."
Endorsements: count, averageRating (1-5), items. Rejected claims shown collapsed as "claims we ignored (and why)".
Recent verified sales: amount, campaign, date, txHash linking to the explorer.
Offer: campaignId, channel, audience, askBps, expectedReach, 72h expiry countdown.
Decision: approved/rejected + approveTx. Link: code, campaignId, expiry, copy + QR.
Invite: from merchant (verified flag), campaign, 48h expiry, accept/decline.
Order: orderId, gross, split (merchant net / commission / fee), status Settled/Held/Released/Refunded/Partially refunded, release date, txHash.
Leaderboard: rank, creator, score, verifiedConversions, grossSettled; filters campaign + time window. Trending: campaigns ranked by live offers (72h).
Relayer error states, friendly and specific: ORDER_EXPIRED, BAD_AUTH_WINDOW, BAD_SELF_PURCHASE ("the buyer can't be the creator"), BAD_MERCHANT_SIG, BAD_BUYER_AUTH, DUPLICATE, GAS_PRICE_TOO_HIGH, DAILY_CAP_EXCEEDED, ADDRESS_LIMIT_EXCEEDED, INSUFFICIENT_RELAYER_BALANCE, SIMULATION_FAILED, TX_REVERTED, TX_TIMEOUT ("check the explorer before retrying", never a blind retry).
Honesty rules: label testnet everywhere; never claim gasless works without a settled tx to show; money state comes from chain (show a "chain-confirmed" tick), Arkiv-sourced data may lag (show "syncing" skeletons). The refund UI is designed but flagged "refund model pending".

=====================================================
7. SCREEN-BY-SCREEN SPEC (desktop 1440 + mobile 390 for each)
=====================================================
S1 LANDING (the showpiece)
 a. Top: thin testnet bar, then the nav with the big wordmark.
 b. HERO, must fit one viewport at 1440x900 with NO overlaps or cut-offs.
    Eyebrow row: "NUMA / DROP-IN USDT CHECKOUT" left, "WHITECHAIN SEPOLIA / 1874" right.
    Headline (fluid, max 3 lines): "FAKE CLICKS" / "EARN" + the red "$0." stamp on the same line as EARN, rotated -4deg, about 60% of the headline cap height. The stamp may overlap the headline slightly but NEVER covers readable text.
    Tagline BELOW the headline in Bone, 18px, max-width 520px: "Pay creators only when a real sale settles. No clicks. No impressions. No creative accounting."
    Two CTA blocks below the tagline, one aligned row of equal height, 24-28px type: "I SELL THINGS" (merchant) and "I MOVE PRODUCT" (creator). They never overlap the headline.
    Right column, separated from the headline by a thin vertical rule: "settled today" green counter (14,882.40 USDT . TESTNET), then the real-hand cursor with the "+$12.50 CHAIN-CONFIRMED" ticket, all on the same grid.
    Behind everything: the giant outlined "numa" wordmark and drifting bot cursors.
 c. Marquee row 1 (left to right, green): live settled sales "creator.eth . +$8.40 . 0x9f..c21 . 12s ago". Row 2 (right to left, red): rejected bot clicks "bot 192.x . $0.00". Pause on hover.
 d. 01 MANIFESTO: lowercase long-form, 6-8 lines, dry voice.
 e. 02 THE SPLIT: scroll-scrubbed diagram. One USDT bar enters a router box and splits into Merchant net / Held commission (with a refund-window clock) / Protocol fee <=1%. A price + commission slider updates the numbers live, with honest integer rounding.
 f. 03 "500 CLICKS VS 1 SALE": left, a counter races to 500 while money stays $0.00 with a red RGB-split glitch; right, one ticket prints out $10.00 in green.
 g. 04 Bone-inverted section: Merchant / Creator / Buyer stories as three DIFFERENT layouts (not equal cards).
 h. 05 GASLESS: a receipt prints, a buyer wallet shows 0 WBT, "no gas prompt".
 i. 06 TRUST: "how we know it's real" as a chain-of-custody visual (owner-checked entities, OrderSettled match) plus an honest "what we can't prove" block (wash trading, sybils).
 j. 07 Trending campaigns + top creators preview.
 k. 08 SDK teaser: <NumaCheckout orderUrl="/api/order" /> in a poster-style terminal block.
 l. Footer: full-width cropped wordmark, marquee, links, "testnet only" stamp.
S2 HOW IT WORKS: horizontal scroll-snap story, 6 steps (campaign, offer, approve, link, pay, settle/release), with campaign lifecycle states.
S3 CAMPAIGN MARKETPLACE: editorial list rows (not cards): name, category, big commission %, ends-in countdown, region, offerCount, verification badge. Filters (category, region, min commission, sort) in a sticky left rail on desktop and a bottom sheet on mobile. Trending strip on top. Row hover inverts to Bone, cursor shows "OFFER ->". Empty, skeleton, error states.
S4 CAMPAIGN DETAIL: poster header, terms, live split calculator, timeline, badge states, "Submit offer" (creator) or "Manage" (owner).
S5 OFFER FLOW (creator): 3-step modal (channel + audience / ask % slider capped at the campaign max + expected reach / review + sign). Validation messages, 72h countdown on success, a network-switch prompt for Arkiv (tGLM) with faucet help.
S6 CREATOR DISCOVERY (merchant): search by niche/channel/max ask/open-only; rows with score badge and label; a compare drawer for 2-3 creators; "Invite".
S7 CREATOR CARD (public): HUGE score numeral or the null state, verified stats, endorsements, recent verified sales with tx links, collapsed ignored claims, niche tags, open-for-work state, and an exportable 1200x630 share card.
S8 LEADERBOARD: asymmetric podium for the top 3, a table below, filters (campaign + days), a sparkline per creator, a "verified on-chain only" explainer.
S9 CREATOR HOME: earnings (Held / Released / Total), next release countdown, live offers with 72h timers, invites inbox, recommendations carousel, link manager, quick-start checklist.
S10 LINK MANAGER: create (code, campaign, expiry), copy, QR, clicks shown as grey "$0 earned" to reinforce the thesis, revoke.
S11 EARNINGS: chart of settled gross + commission over time, a status breakdown, an orders table with tx links, CSV export, a release-window timeline.
S12 MERCHANT HOME: active campaigns, offers needing a decision, settlements feed, held vs released commission, a refund queue flagged "refund model pending", invites sent.
S13 CREATE CAMPAIGN: 4-step wizard (basics / commission % with a 50% max guard and fee display / schedule with the ~175-day guard note / payout signer address). Then a transaction stepper explaining the TWO actions: register on Whitechain and publish to Arkiv.
S14 OFFER REVIEW (merchant): offers list with a creator score + endorsements side panel; Approve (on-chain approveCreator + Arkiv decision) / Reject; batch actions; a confirmation modal stating what it permits.
S15 INVITES: send (48h expiry) and receive; verified-inviter badge; accept/decline; expired state.
S16 BUYER CHECKOUT (/pay/[code]) and EMBED WIDGET: product summary, price, a collapsible "who gets what" split, wallet connect, ONE signature step in plain words ("authorize 25.00 USDT to numa router . no gas"), a stepper Sign -> Relaying -> Settled, receipt printing, tx hash + explorer link. States: every relayer error, wrong network, insufficient USDT, expired order (auto re-fetch), duplicate. Widget variants: modal, inline, compact, light/dark themeable.
S17 RECEIPT (/receipt/[txHash]): shareable ticket with split, Held/Released status, window countdown, chain-confirmed tick, numa stamp.
S18 VERIFY: paste tx hash or order id; shows the OrderSettled match, creator, merchant, split, and whether Arkiv entities agree. Judge-friendly.
S19 DEMO SHOP: a fictional streetwear/sneaker store with its OWN identity, proving drop-in embedding.
S20 SYSTEM STATES: wallet modal, wrong network, no wallet, signature rejected, pending/confirmed/failed toasts, 404 (lost bot cursors), 500, offline, maintenance.

=====================================================
8. COMPONENT LIBRARY (every component with default, hover, focus, active, disabled, loading, error, success)
=====================================================
Buttons (primary with hard shadow, secondary outline, ghost, destructive red, icon, big block-CTA), inputs (text, amount with USDT suffix, address with checksum + copy, slider with bps and % labels, select, multi-tag, toggle, date), segmented control, badges (Verified / Unverified / Unchecked / Held / Released / Refunded / Settled / Live / Ending soon), stamps (rotatable), tags, tabs, stepper, transaction toast, modal/sheet, tooltip/popover, sortable dense table with mono numbers, list row, big-numeral stat tile, score dial, star rating, sparkline, charts (line/bar/stacked), timeline, countdown, address chip, tx hash chip, empty states with custom illustrations, grain-shimmer skeletons, marquee, ticker, navbar, full-screen menu, footer, cursor states, QR block, code block, receipt/ticket, split diagram, network pill, wallet button, faucet help card.

=====================================================
9. ANIMATION SPEC (build as REAL interactive animation; annotate timings on a dedicated frame)
=====================================================
Easing tokens: expo-out cubic-bezier(.19,1,.22,1) default; snap cubic-bezier(1,.26,0,1) for menu/overlays; linear for marquees.
Durations: micro 150 / base 300 / large 500 / hero 700 / ambient 10s. Stagger 40-100ms.
- Load: wordmark intro, then headline letters rise from a mask (40ms stagger), the "$0." stamp slams in last (scale 1.4 -> 1, rotate -10 -> -4deg, 80ms squash, tiny screen shake), then tagline and CTAs slide up.
- Hero ambient: 20-30 tiny pixel bot-cursors drift in red at 30% opacity; one real hand-cursor sweeps through and triggers the "+$12.50" ticket with a green ring pulse. Loop about every 8s.
- "settled today" counter counts up on load and ticks up every few seconds with a green flash.
- Marquees: infinite linear, opposite directions, pause on hover.
- Custom cursor: small dot that grows into a labeled circle over interactive elements ("OFFER ->", "VIEW TX", "COPY"). Magnetic pull (<=8px) on the big CTA blocks.
- Nav: sticky, shrinks on scroll to a solid bar. Hamburger lines slide away; a full-screen black overlay wipes up (500ms) and links rise in stagger. The segmented control highlight slides.
- Scroll: every section reveals with translateY 40 + fade, 80ms stagger, once; headings split by word; hero type scales to 0.85 and fades; the giant "numa" parallaxes slowly; THE SPLIT scrubs with scroll; the 500-clicks section triggers on enter; the how-it-works story is pinned horizontal.
- Hover: row inversion wipe left to right (300ms), button fill wipe + arrow slide, image grain increases.
- Settlement moment (the signature interaction): receipt prints from a slot, green ring burst, "SETTLED" stamp slams in at -6deg with a micro squash. No confetti. Failure: a red "FAILED" stamp with the reason and no celebration.
- Bot rejection: red "$0.00" RGB-split glitch; the number never increments.
- Loading: grain shimmer skeletons; stepper segments fill in sequence; "syncing with Arkiv" pulse.
- Page transitions: black wipe from the bottom, 500ms.
- Ambient: slow 10s alternate pan on textures and photos; animated film grain.
- prefers-reduced-motion: static variants of every animation; only fades remain.
Performance: animate only transform and opacity; marquees via CSS; scroll scrubbing via GSAP ScrollTrigger + Lenis; Framer Motion for components.

=====================================================
10. UX PRINCIPLES AND FLOWS
=====================================================
- Plain language first, jargon second ("authorize payment", not "EIP-3009"). A "show me the receipts" drawer holds technical details for judges.
- Always show the split before the user pays.
- Every on-chain action: explain, confirm, pending, result, with explorer links.
- Two-network clarity: label which action uses Whitechain (money) vs Arkiv (listing), with one-time guided setup for tGLM and WBT faucets.
- Optimistic UI only for Arkiv, never for money.
- Empty states teach the thesis (e.g. "no verified sales yet. clicks don't count. here's how to get your first.").
- Buyer checkout is mobile-first; creator screens work on mobile; the merchant dashboard is desktop-first but fully responsive.
Design these connected prototype flows: (1) Merchant: create campaign, review offers, approve, first settlement. (2) Creator: profile, discover, offer, approved, link, earnings, release. (3) Buyer: open link, connect, sign, settled receipt. (4) Judge: /verify a tx. (5) Failure paths for each.

=====================================================
11. ACCESSIBILITY AND RESPONSIVE
=====================================================
WCAG AA, 44px touch targets, visible green focus ring, annotated keyboard order, semantic landmarks, aria for steppers and timers, never color-only status (always icon + label), text selectable, readable at 200% zoom. Breakpoints 390 / 834 / 1440 / 1920 (max content width 1600). Check for overlaps and cut-offs at every breakpoint.

=====================================================
12. COPYWRITING (write all real copy)
=====================================================
Voice: lowercase manifesto, dry, confident, a little menacing toward bots; no corporate buzzwords. Short, loud headlines. Calm, specific error copy. Examples: "bots can click. they can't pay." / "no sale, no commission. that's the whole deal." / "your buyer needs zero gas. we checked." / "claims we ignored (and why)". Write microcopy for every state above.

=====================================================
13. FIGMA FILE ORGANIZATION AND DELIVERABLES
=====================================================
Pages: 00 Cover / 01 Foundations (tokens, type, grid, texture, icons) / 02 Components / 03 Landing / 04 Marketplace and Creator / 05 Merchant / 06 Buyer and Embed / 07 System states / 08 Motion specs / 09 Prototype flows / 10 Dev handoff (spacing, variables export, easings, asset export list, naming map to routes and API fields) / 11 Open questions.
Use auto-layout, variables and component properties everywhere; name layers like code (campaign/row/default). Provide light/dark modes, 1x/2x exports, SVG icons, OG templates, favicon + app icons, the logo set, 3 brand posters and a sticker/stamp pack.
Finish with a "design critique" frame listing what to user-test and where the design conflicts with technical constraints (Arkiv indexing lag, refund model pending).
Deliver the published site and list what you built under each numbered section.
````
