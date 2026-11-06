import { describe, expect, it } from "vitest";
import { parseRoute, routeToPath, titleFor, type Route, type View } from "./routes";

const ADDR = "0x71c9d8f03a00000000000000000000000000d03a";

describe("parseRoute", () => {
  it("maps the static pages", () => {
    expect(parseRoute("/").view).toBe("home");
    expect(parseRoute("/how-it-works").view).toBe("how");
    expect(parseRoute("/campaigns").view).toBe("campaigns");
    expect(parseRoute("/leaderboard").view).toBe("leaderboard");
    expect(parseRoute("/creator").view).toBe("creatorApp");
    expect(parseRoute("/merchant").view).toBe("merchant");
    expect(parseRoute("/demo-shop").view).toBe("demo");
    expect(parseRoute("/verify").view).toBe("verify");
    expect(parseRoute("/system-states").view).toBe("system");
  });

  it("reads the campaign id from /campaigns/:id", () => {
    expect(parseRoute("/campaigns/7")).toEqual({ view: "campaignDetail", campaignId: "7" });
    expect(parseRoute("/campaigns/123456789012345678")).toMatchObject({ campaignId: "123456789012345678" });
  });

  it("rejects non-numeric or absurd campaign ids instead of guessing", () => {
    expect(parseRoute("/campaigns/SP-008").view).toBe("notFound");
    expect(parseRoute("/campaigns/-1").view).toBe("notFound");
    expect(parseRoute("/campaigns/1.5").view).toBe("notFound");
    expect(parseRoute("/campaigns/1234567890123456789012").view).toBe("notFound");
  });

  it("reads and normalises a creator address", () => {
    expect(parseRoute(`/creators/${ADDR}`)).toEqual({ view: "creator", creator: ADDR });
    expect(parseRoute(`/creators/${ADDR.toUpperCase().replace("0X", "0x")}`).creator).toBe(ADDR);
  });

  it("serves the sample card at /creators and 404s a malformed address", () => {
    expect(parseRoute("/creators")).toEqual({ view: "creator" });
    expect(parseRoute("/creators/0x1234").view).toBe("notFound");
    expect(parseRoute(`/creators/${ADDR}00`).view).toBe("notFound");
    expect(parseRoute("/creators/not-an-address").view).toBe("notFound");
  });

  it("treats pay/receipt links as the checkout", () => {
    expect(parseRoute("/pay/RIO-08-X").view).toBe("checkout");
    expect(parseRoute("/receipt/0xabc").view).toBe("checkout");
    // the click tracker redirects to /checkout/<code>
    expect(parseRoute("/checkout/RIO-08-X").view).toBe("checkout");
    expect(parseRoute("/checkout").view).toBe("notFound");
    expect(parseRoute("/pay").view).toBe("notFound");
  });

  it("ignores trailing slashes and 404s everything else", () => {
    expect(parseRoute("/campaigns/").view).toBe("campaigns");
    expect(parseRoute("/leaderboard///").view).toBe("leaderboard");
    expect(parseRoute("/nope").view).toBe("notFound");
    expect(parseRoute("/campaigns/7/extra").view).toBe("notFound");
    expect(parseRoute("/design-handoff").view).toBe("notFound");
  });
});

describe("routeToPath", () => {
  const routes: Route[] = [
    { view: "home" },
    { view: "how" },
    { view: "campaigns" },
    { view: "campaignDetail", campaignId: "42" },
    { view: "creator", creator: ADDR },
    { view: "creator" },
    { view: "leaderboard" },
    { view: "creatorApp" },
    { view: "merchant" },
    { view: "demo" },
    { view: "verify" },
    { view: "system" },
  ];
  it("round-trips every navigable route", () => {
    for (const r of routes) expect(parseRoute(routeToPath(r))).toEqual(r);
  });
  it("falls back to the list when a detail route has no id", () => {
    expect(routeToPath({ view: "campaignDetail" })).toBe("/campaigns");
  });
  it("has a distinct, non-empty title for every view", () => {
    const views: View[] = ["home", "how", "campaigns", "campaignDetail", "creator", "leaderboard", "creatorApp", "merchant", "checkout", "demo", "verify", "system", "notFound"];
    for (const v of views) expect(titleFor(v).length).toBeGreaterThan(3);
    expect(new Set(views.map(titleFor)).size).toBe(views.length);
  });
});
