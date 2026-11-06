/**
 * URL <-> screen mapping. Pure functions, no React, so it can be unit tested.
 * The app keeps its in-memory `view` state; this module only translates it to and from
 * `location.pathname`, so links, refresh and the browser's back/forward buttons work.
 */

export type View =
  | "home"
  | "how"
  | "campaigns"
  | "campaignDetail"
  | "creator"
  | "leaderboard"
  | "creatorApp"
  | "merchant"
  | "checkout"
  | "demo"
  | "verify"
  | "system"
  | "notFound";

export interface Route {
  view: View;
  /** wallet address for /creators/:address (undefined = the sample card) */
  creator?: string;
  /** on-chain campaign id for /campaigns/:id */
  campaignId?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NUMERIC_ID = /^\d{1,18}$/;

const STATIC: Record<string, View> = {
  "/": "home",
  "/how-it-works": "how",
  "/campaigns": "campaigns",
  "/creators": "creator",
  "/leaderboard": "leaderboard",
  "/creator": "creatorApp",
  "/merchant": "merchant",
  "/demo-shop": "demo",
  "/verify": "verify",
  "/system-states": "system",
};

/** Unknown or malformed paths are a 404, never silently the home page. */
export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const fixed = STATIC[path];
  if (fixed) return { view: fixed };

  const seg = path.split("/").filter(Boolean);
  if (seg.length === 2) {
    const [head, arg] = seg;
    if (head === "campaigns" && NUMERIC_ID.test(arg)) return { view: "campaignDetail", campaignId: arg };
    if (head === "creators" && ADDRESS.test(arg)) return { view: "creator", creator: arg.toLowerCase() };
    if ((head === "pay" || head === "receipt") && arg) return { view: "checkout" };
  }
  return { view: "notFound" };
}

export function routeToPath(r: Route): string {
  switch (r.view) {
    case "home":
      return "/";
    case "how":
      return "/how-it-works";
    case "campaigns":
      return "/campaigns";
    case "campaignDetail":
      return r.campaignId ? `/campaigns/${r.campaignId}` : "/campaigns";
    case "creator":
      return r.creator ? `/creators/${r.creator.toLowerCase()}` : "/creators";
    case "leaderboard":
      return "/leaderboard";
    case "creatorApp":
      return "/creator";
    case "merchant":
      return "/merchant";
    case "checkout":
      return "/pay/demo";
    case "demo":
      return "/demo-shop";
    case "verify":
      return "/verify";
    case "system":
      return "/system-states";
    case "notFound":
      return "/404";
  }
}

const TITLES: Record<View, string> = {
  home: "numa — fake clicks earn $0",
  how: "how it works — numa",
  campaigns: "campaigns — numa",
  campaignDetail: "campaign — numa",
  creator: "creator — numa",
  leaderboard: "leaderboard — numa",
  creatorApp: "creator app — numa",
  merchant: "merchant app — numa",
  checkout: "checkout — numa",
  demo: "demo shop",
  verify: "verify a sale — numa",
  system: "system states — numa",
  notFound: "404 — numa",
};

export const titleFor = (view: View) => TITLES[view];
