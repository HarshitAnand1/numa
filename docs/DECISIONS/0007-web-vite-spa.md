# ADR 0007 — `apps/web` starts as a Vite + React SPA (not Next.js)
**Status: Proposed (Member 3, needs team review).**

**Context.** The brief lists Next.js for the frontend. The visual design was produced in Figma Make, which exports a React 19 + Vite + Tailwind v4 app. Every screen exists today as a mock-driven single-page app (client-side view switching, no server rendering, no API calls).

**Decision.** Keep the Figma export as the starting point of `apps/web` (Vite SPA) so the design is not rewritten blind. Nothing in the product needs SSR: pages read chain/Arkiv data through the API at runtime, and checkout signs in the browser.

**Consequences.**
- No Next.js features (file routing, server components). Routing is currently an in-memory `view` switch; real URL routing (e.g. React Router) is a follow-up.
- Trade-off: SEO / OG images for creator cards would need server rendering or a small edge function later.
- If the team prefers Next.js, the components in `src/App.tsx` are plain React and can be moved over; revisit before wiring `@numa/sdk-react`.
