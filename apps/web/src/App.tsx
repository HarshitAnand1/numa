import { useEffect, useMemo, useRef, useState } from "react";

type View =
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
  | "handoff";

const viewPaths: Record<View, string> = {
  home: "/",
  how: "/how-it-works",
  campaigns: "/campaigns",
  campaignDetail: "/campaigns/SP-008",
  creator: "/creators/0x71c9d03a",
  leaderboard: "/leaderboard",
  creatorApp: "/creator",
  merchant: "/merchant",
  checkout: "/pay/RIO-08-X",
  demo: "/demo-shop",
  verify: "/verify",
  system: "/system-states",
  handoff: "/design-handoff",
};

function viewFromPath(path: string): View {
  if (/^\/campaigns\/[^/]+/.test(path)) return "campaignDetail";
  if (/^\/creators\/[^/]+/.test(path)) return "creator";
  if (/^\/pay\/[^/]+/.test(path) || /^\/receipt\//.test(path)) return "checkout";
  return (Object.entries(viewPaths).find(([, value]) => value === path)?.[0] as View) || "home";
}

const campaigns = [
  {
    id: "SP-008",
    name: "NO SLEEP / DROP 08",
    category: "streetwear",
    region: "global",
    commission: 18,
    ends: "2d 14h",
    offers: 42,
    verified: "verified",
  },
  {
    id: "VN-221",
    name: "VINYL IS NOT DEAD",
    category: "music",
    region: "US + EU",
    commission: 24,
    ends: "18h 09m",
    offers: 31,
    verified: "unchecked",
  },
  {
    id: "RN-404",
    name: "RUN AFTER DARK",
    category: "fitness",
    region: "US",
    commission: 12.5,
    ends: "6d 03h",
    offers: 19,
    verified: "verified",
  },
  {
    id: "BK-110",
    name: "READ BANNED BOOKS",
    category: "culture",
    region: "global",
    commission: 30,
    ends: "9d 22h",
    offers: 11,
    verified: "unverified",
  },
];

const sales = [
  "rio.jpg · +8.40 USDT · 0x9f…c21 · 12s ago",
  "0x71…d03 · +12.50 USDT · 0xab…901 · 38s ago",
  "mara.wav · +4.20 USDT · 0x17…ec2 · 1m ago",
];

function Icon({
  name,
  size = 20,
}: {
  name: "arrow" | "check" | "copy" | "wallet" | "external" | "search" | "close";
  size?: number;
}) {
  const paths = {
    arrow: (
      <>
        <path d="M4 12h15M14 6l6 6-6 6" />
      </>
    ),
    check: (
      <>
        <path d="m4 12 5 5L20 6" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="1" />
        <path d="M16 8V5H5v11h3" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 7h15v12H4zM4 7V5h12v2M15 12h4" />
      </>
    ),
    external: (
      <>
        <path d="M13 5h6v6M19 5l-9 9M17 14v5H5V7h5" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    close: (
      <>
        <path d="M5 5l14 14M19 5 5 19" />
      </>
    ),
  };
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="square"
    >
      {paths[name]}
    </svg>
  );
}

function Stamp({ children, tone = "red" }: { children: React.ReactNode; tone?: "red" | "green" }) {
  return <span className={`stamp stamp-${tone}`}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/* Motion helpers. No animation library: CSS does the drawing, these   */
/* only toggle classes / custom properties. All of it is skipped when  */
/* the visitor prefers reduced motion.                                 */
/* ------------------------------------------------------------------ */

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Headline split into masked letters that rise one by one. */
function SplitText({ text, start = 0 }: { text: string; start?: number }) {
  return (
    <span className="split" aria-hidden="true">
      {text.split("").map((c, i) =>
        c === " " ? (
          <span key={i}>&nbsp;</span>
        ) : (
          <span className="ch-mask" key={i}>
            <span className="ch" style={{ "--i": start + i } as React.CSSProperties}>
              {c}
            </span>
          </span>
        ),
      )}
    </span>
  );
}

function useCountUp(target: number, run: boolean, duration = 1800) {
  const [value, setValue] = useState(run && !reducedMotion() ? 0 : target);
  useEffect(() => {
    if (!run) return;
    if (reducedMotion()) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      setValue(target * (1 - Math.pow(1 - k, 4)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, duration]);
  return value;
}

/** Counts up once when scrolled into view. */
function CountOnView({ to, pad = 0 }: { to: number; pad?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const v = useCountUp(to, seen, 2200);
  return <span ref={ref}>{String(Math.round(v)).padStart(pad, "0")}</span>;
}

/** "settled today": counts up on load, then ticks up with a green flash. */
function SettledToday({ run }: { run: boolean }) {
  const [extra, setExtra] = useState(0);
  const [tick, setTick] = useState(0);
  const base = useCountUp(14882.4, run, 2400);
  useEffect(() => {
    if (!run || reducedMotion()) return;
    const id = window.setInterval(() => {
      setExtra((x) => x + Math.round((3 + Math.random() * 12) * 100) / 100);
      setTick((t) => t + 1);
    }, 3800);
    return () => window.clearInterval(id);
  }, [run]);
  return (
    <b key={tick} className={tick ? "tick" : ""}>
      {(base + extra).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
    </b>
  );
}

/** Intro: the wordmark draws in letter by letter, then the curtain lifts. */
function Loader({ out }: { out: boolean }) {
  return (
    <div className={`loader ${out ? "out" : ""}`} role="status" aria-label="Loading numa">
      <div className="loader-word" aria-hidden="true">
        {"numa".split("").map((c, i) => (
          <span key={i} style={{ "--i": i } as React.CSSProperties}>
            {c}
          </span>
        ))}
      </div>
      <div className="loader-bar" aria-hidden="true">
        <i />
        <span>NUMA / PAY ONLY ON REAL SALES</span>
        <span>TESTNET</span>
      </div>
    </div>
  );
}

/** Dot that trails the pointer and grows into a labelled circle on interactive things. */
function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches || reducedMotion()) return;
    document.documentElement.classList.add("has-cursor");
    let x = -100,
      y = -100,
      rx = -100,
      ry = -100,
      raf = 0;
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      const t = e.target as HTMLElement | null;
      const tagged = t?.closest<HTMLElement>("[data-cursor]");
      const interactive = t?.closest("a,button,summary,[role=button],input,select,label");
      const r = ring.current;
      if (!r) return;
      r.classList.toggle("label", !!tagged);
      r.classList.toggle("grow", !tagged && !!interactive);
      if (label.current) label.current.textContent = tagged?.dataset.cursor ?? "";
    };
    const loop = () => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      if (dot.current) dot.current.style.transform = `translate(${x}px, ${y}px)`;
      if (ring.current) ring.current.style.transform = `translate(${rx}px, ${ry}px)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener("pointermove", move);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("has-cursor");
    };
  }, []);
  return (
    <>
      <div className="cursor-ring" ref={ring} aria-hidden="true">
        <span ref={label} />
      </div>
      <div className="cursor-dot" ref={dot} aria-hidden="true" />
    </>
  );
}

/**
 * Hero physics. Bots flock toward the pointer and orbit it (they love a click that
 * pays nothing); a click scatters them and drops a red $0.00. The headline letters
 * lean away from the pointer, background layers shift with depth, and the marquees
 * skew with scroll speed. rAF loop, transform/translate only; off for reduced motion.
 */
function useHeroFX(ready: boolean) {
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>(".hero");
    if (!hero || reducedMotion()) return;
    const swarm = hero.querySelector<HTMLElement>(".cursor-swarm");
    const bots = Array.from(hero.querySelectorAll<HTMLElement>(".cursor-swarm > span"));
    const letters = Array.from(hero.querySelectorAll<HTMLElement>("h1 .ch"));
    const h1 = hero.querySelector<HTMLElement>("h1");
    const marquees = document.querySelector<HTMLElement>(".marquees");
    let W = hero.clientWidth;
    let H = hero.clientHeight;
    const st = bots.map(() => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 1.6,
      vy: (Math.random() - 0.5) * 1.6,
    }));
    const p = { x: 0, y: 0, active: false, mx: 0, my: 0, sx: 0, sy: 0 };
    let visible = true;
    let lastY = window.scrollY;
    let vel = 0;
    let raf = 0;
    let settledTimer = 0;
    if (ready) settledTimer = window.setTimeout(() => h1?.classList.add("letters-free"), 2300);

    const onMove = (e: PointerEvent) => {
      const r = hero.getBoundingClientRect();
      p.x = e.clientX - r.left;
      p.y = e.clientY - r.top;
      p.active = true;
      p.mx = (p.x / W - 0.5) * 2;
      p.my = (p.y / H - 0.5) * 2;
      if (!h1?.classList.contains("letters-free")) return;
      letters.forEach((el) => {
        const b = el.getBoundingClientRect();
        const dx = b.left + b.width / 2 - e.clientX;
        const dy = b.top + b.height / 2 - e.clientY;
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.max(0, 1 - d / 190);
        el.style.translate = `${((dx / d) * k * 26).toFixed(1)}px ${((dy / d) * k * 18).toFixed(1)}px`;
        el.style.rotate = `${(k * (dx > 0 ? 7 : -7)).toFixed(1)}deg`;
      });
    };
    const onLeave = () => {
      p.active = false;
      p.mx = 0;
      p.my = 0;
      letters.forEach((el) => {
        el.style.translate = "";
        el.style.rotate = "";
      });
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button,a,summary")) return;
      const r = hero.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      st.forEach((s) => {
        const dx = s.x - cx;
        const dy = s.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 380) {
          const f = (1 - d / 380) * 14;
          s.vx += (dx / d) * f;
          s.vy += (dy / d) * f;
        }
      });
      const z = document.createElement("span");
      z.className = "pop-zero";
      z.textContent = "$0.00";
      z.style.left = `${cx}px`;
      z.style.top = `${cy}px`;
      swarm?.appendChild(z);
      window.setTimeout(() => z.remove(), 1000);
    };
    const onResize = () => {
      W = hero.clientWidth;
      H = hero.clientHeight;
    };
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0 });
    io.observe(hero);
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);
    hero.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onResize);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      // scroll velocity -> marquee skew (always, cheap)
      const y = window.scrollY;
      vel += (y - lastY - vel) * 0.14;
      lastY = y;
      marquees?.style.setProperty("--vel", Math.max(-10, Math.min(10, vel * 0.5)).toFixed(2));
      if (!visible) return;
      p.sx += (p.mx - p.sx) * 0.06;
      p.sy += (p.my - p.sy) * 0.06;
      hero.style.setProperty("--mx", p.sx.toFixed(3));
      hero.style.setProperty("--my", p.sy.toFixed(3));
      for (let i = 0; i < bots.length; i++) {
        const s = st[i];
        s.vx += (Math.random() - 0.5) * 0.12;
        s.vy += (Math.random() - 0.5) * 0.12;
        if (p.active) {
          const dx = p.x - s.x;
          const dy = p.y - s.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d > 150) {
            s.vx += (dx / d) * 0.05;
            s.vy += (dy / d) * 0.05;
          } else {
            // orbit: swirl around the pointer, never touch it
            s.vx += (-dy / d) * 0.06 - (dx / d) * 0.03;
            s.vy += (dx / d) * 0.06 - (dy / d) * 0.03;
          }
        }
        s.vx *= 0.975;
        s.vy *= 0.975;
        const sp = Math.hypot(s.vx, s.vy);
        if (sp > 4.2) {
          s.vx = (s.vx / sp) * 4.2;
          s.vy = (s.vy / sp) * 4.2;
        }
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < -30) s.x = W + 30;
        if (s.x > W + 30) s.x = -30;
        if (s.y < -30) s.y = H + 30;
        if (s.y > H + 30) s.y = -30;
        const rot = (Math.atan2(s.vy, s.vx) * 180) / Math.PI + 135;
        bots[i].style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) rotate(${rot.toFixed(0)}deg)`;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settledTimer);
      io.disconnect();
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      hero.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
      marquees?.style.removeProperty("--vel");
    };
  }, [ready]);
}

/**
 * Scroll choreography for whatever view is mounted:
 *  - direct children of each main > section reveal with a stagger,
 *  - [data-scrub] elements get --p (0..1) as they cross the viewport,
 *  - [data-magnetic] elements lean toward the pointer (<= 8px).
 */
function useScrollMotion(view: View, enabled: boolean) {
  useEffect(() => {
    if (!enabled || reducedMotion()) return;
    document.documentElement.classList.add("js-ready");
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(
        "main > section:not(.hero) > *, main > header > *, .io-ticket, .io-stamp",
      ),
    );
    targets.forEach((el) => {
      if (!el.classList.contains("io-ticket") && !el.classList.contains("io-stamp")) {
        const i = Array.from(el.parentElement?.children ?? []).indexOf(el);
        el.style.setProperty("--rv", String(Math.min(i, 5)));
        el.classList.add("rv");
      }
    });
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    targets.forEach((el) => io.observe(el));

    const scrub = Array.from(document.querySelectorAll<HTMLElement>("[data-scrub]"));
    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      scrub.forEach((el) => {
        const r = el.getBoundingClientRect();
        const p =
          el.dataset.scrub === "out"
            ? Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)))
            : Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
        el.style.setProperty("--p", p.toFixed(3));
      });
      document.querySelector(".nav")?.classList.toggle("scrolled", window.scrollY > 40);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    const mags = Array.from(document.querySelectorAll<HTMLElement>("[data-magnetic]"));
    const offs: Array<() => void> = [];
    mags.forEach((el) => {
      const mv = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const dx = ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 8;
        const dy = ((e.clientY - (r.top + r.height / 2)) / (r.height / 2)) * 8;
        el.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
      };
      const lv = () => {
        el.style.translate = "";
      };
      el.addEventListener("pointermove", mv);
      el.addEventListener("pointerleave", lv);
      offs.push(() => {
        el.removeEventListener("pointermove", mv);
        el.removeEventListener("pointerleave", lv);
      });
    });
    return () => {
      io.disconnect();
      offs.forEach((f) => f());
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [view, enabled]);
}

function Logo() {
  return (
    <button
      className="logo"
      onClick={() => window.dispatchEvent(new CustomEvent("nav", { detail: "home" }))}
      aria-label="numa home"
    >
      n<span>u</span>ma
    </button>
  );
}

function Header({ view, setView }: { view: View; setView: (v: View) => void }) {
  const [menu, setMenu] = useState(false);
  const go = (v: View) => {
    setView(v);
    setMenu(false);
  };
  return (
    <>
      <div className="testnet">
        <span>●</span> TESTNET — no real money. probably for the best.
      </div>
      <header className="nav">
        <Logo />
        <nav className="desktop-nav" aria-label="Primary">
          <button className={view === "how" ? "active" : ""} onClick={() => go("how")}>
            how it works
          </button>
          <button className={view === "campaigns" ? "active" : ""} onClick={() => go("campaigns")}>
            campaigns
          </button>
          <button
            className={view === "leaderboard" ? "active" : ""}
            onClick={() => go("leaderboard")}
          >
            leaderboard
          </button>
          <button onClick={() => go("verify")}>verify a sale</button>
        </nav>
        <div className="nav-actions">
          <div
            className="role-switch"
            role="group"
            aria-label="Switch role"
            data-role={view === "merchant" ? "m" : view === "creatorApp" ? "c" : ""}
          >
            <i className="role-thumb" aria-hidden="true" />
            <button className={view === "merchant" ? "active" : ""} onClick={() => go("merchant")}>
              MERCHANT
            </button>
            <button
              className={view === "creatorApp" ? "active" : ""}
              onClick={() => go("creatorApp")}
            >
              CREATOR
            </button>
          </div>
          <span className="network-pill">
            <i /> whitechain · 1874
          </span>
          <button className="wallet-button">
            <Icon name="wallet" /> <span>0x71…d03</span>
          </button>
          <button
            className="menu-button"
            onClick={() => setMenu(!menu)}
            aria-label="Open menu"
            aria-expanded={menu}
          >
            <span />
            <span />
          </button>
        </div>
      </header>
      {menu && (
        <div className="menu-overlay">
          <div className="menu-top">
            <Logo />
            <button onClick={() => setMenu(false)} aria-label="Close menu">
              <Icon name="close" size={32} />
            </button>
          </div>
          <div className="menu-links">
            {(
              [
                "home",
                "how",
                "campaigns",
                "creator",
                "leaderboard",
                "creatorApp",
                "merchant",
                "demo",
                "verify",
                "system",
              ] as View[]
            ).map((v, i) => (
              <button
                key={v}
                onClick={() => go(v)}
                style={{ "--i": i } as React.CSSProperties}
              >
                <small>0{i + 1}</small>
                {v === "creatorApp" ? "creator app" : v}
              </button>
            ))}
          </div>
          <p>
            money on whitechain.
            <br />
            claims on arkiv.
            <br />
            confuse them at your peril.
          </p>
        </div>
      )}
    </>
  );
}

function Marquees() {
  return (
    <div className="marquees" aria-label="Live network activity">
      <div className="marquee settled">
        <div>
          {[...sales, ...sales].map((s, i) => (
            <span key={i}>
              SETTLED <b>{s}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="marquee bots">
        <div>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i}>
              BOT {192 + i}.18.{i}.x <b>$0.00</b> · REJECTED
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SplitCalculator({ compact = false }: { compact?: boolean }) {
  const [price, setPrice] = useState(compact ? 25 : 50);
  const [commission, setCommission] = useState(compact ? 18 : 20);
  const fee = Math.floor(price * 0.01 * 100) / 100;
  const creator = Math.floor(price * commission) / 100;
  const merchant = Math.round((price - creator - fee) * 100) / 100;
  return (
    <div className={`split-calc ${compact ? "compact" : ""}`}>
      {!compact && (
        <div className="section-kicker">
          <span>03</span> drag the numbers. the contract won’t flinch.
        </div>
      )}
      <div className="split-inputs">
        <label>
          sale price <strong>{price.toFixed(2)} USDT</strong>
          <input
            type="range"
            min="5"
            max="200"
            step="5"
            value={price}
            onChange={(e) => setPrice(+e.target.value)}
          />
        </label>
        <label>
          creator commission <strong>{commission}%</strong>
          <input
            type="range"
            min="1"
            max="50"
            value={commission}
            onChange={(e) => setCommission(+e.target.value)}
          />
        </label>
      </div>
      <div className="flow">
        <div className="coin-in">
          <small>one payment</small>
          <strong>{price.toFixed(2)}</strong>
          <span>USDT IN</span>
        </div>
        <div className="router">
          <span>NUMA ROUTER</span>
          <i>↳</i>
        </div>
        <div className="split-results">
          <div className="merchant-result">
            <span>merchant / instant</span>
            <strong>{merchant.toFixed(2)}</strong>
            <small>USDT</small>
          </div>
          <div className="creator-result">
            <span>creator / held</span>
            <strong>{creator.toFixed(2)}</strong>
            <small>USDT · releases in 7d</small>
          </div>
          <div className="fee-result">
            <span>protocol / ≤1%</span>
            <strong>{fee.toFixed(2)}</strong>
            <small>USDT</small>
          </div>
        </div>
      </div>
      <p className="rounding-note">
        amounts round down to the smallest USDT unit. nobody gets the imaginary fraction.
      </p>
    </div>
  );
}

function Home({ setView, ready }: { setView: (v: View) => void; ready: boolean }) {
  useHeroFX(ready);
  return (
    <main>
      <section className="hero" data-scrub="out">
        <div className="hero-word" aria-hidden="true">
          n<i>u</i>ma
        </div>
        <div className="cursor-swarm" aria-hidden="true">
          {Array.from({ length: 26 }, (_, i) => (
            <span key={i}>↖</span>
          ))}
        </div>
        <div className="hero-meta">
          <span>
            <b>NUMA</b> / DROP-IN USDT CHECKOUT
          </span>
          <span>WHITECHAIN SEPOLIA / 1874</span>
        </div>
        <h1 aria-label="Fake clicks earn $0.">
          <span className="line">
            <SplitText text="FAKE CLICKS" />
          </span>
          <span className="line">
            <SplitText text="EARN" start={12} />
            <Stamp>$0.</Stamp>
          </span>
        </h1>
        <div className="real-signal">
          <span className="hand" aria-hidden="true">
            ☝
          </span>
          <b>+$12.50</b>
          <small>chain-confirmed</small>
        </div>
        <div className="hero-lower">
          <div className="hero-copy">
            <p className="hero-sub">
              Pay creators only when a real sale settles.
              <br />
              <em>No clicks. No impressions. No creative accounting.</em>
            </p>
            <div className="hero-ctas">
              <button data-magnetic data-cursor="GO →" onClick={() => setView("campaigns")}>
                <small>MERCHANT / 01</small>
                <span>I SELL THINGS</span>
                <Icon name="arrow" size={30} />
              </button>
              <button data-magnetic data-cursor="GO →" onClick={() => setView("creator")}>
                <small>CREATOR / 02</small>
                <span>I MOVE PRODUCT</span>
                <Icon name="arrow" size={30} />
              </button>
            </div>
          </div>
          <aside className="hero-aside" aria-label="Live settlement">
            <div className="settled-today">
              <small>settled today</small>
              <SettledToday run={ready} />
              <span>USDT · TESTNET</span>
            </div>
          </aside>
        </div>
      </section>
      <Marquees />

      <section className="manifesto">
        <div className="section-kicker">
          <span>01</span> a small manifesto
        </div>
        <p>
          bots can click.
          <br />
          they can scroll.
          <br />
          they can lie with impressive speed.
          <br />
          <em>but they can’t settle a sale.</em>
          <br />
          numa ignores the theatre and watches the money.
          <br />
          one real payment. one honest commission.
          <br />
          that’s the whole deal.
        </p>
        <div className="margin-note">
          NO ORACLE
          <br />
          NO STRIPE
          <br />
          NO VIBES
        </div>
      </section>

      <section className="split-section">
        <div className="split-title" data-scrub="in">
          <span>THE</span>
          <strong>SPLIT</strong>
        </div>
        <SplitCalculator />
      </section>

      <section className="comparison">
        <div className="click-side">
          <span className="eyebrow">BOT TRAFFIC / INFLATED</span>
          <b>
            <CountOnView to={500} />
          </b>
          <h2>clicks</h2>
          <div className="zero">$0.00</div>
          <p>congratulations on the server load.</p>
        </div>
        <div className="sale-side">
          <span className="eyebrow">REAL BUYER / SETTLED</span>
          <b>01</b>
          <h2>sale</h2>
          <div className="ticket io-ticket io-stamp">
            <div className="ticket-logo">numa / receipt</div>
            <p>ORDER #NMA-8821</p>
            <p>CREATOR 0x71…d03</p>
            <hr />
            <strong>+$10.00</strong>
            <small>COMMISSION / HELD</small>
            <Stamp tone="green">SETTLED</Stamp>
          </div>
        </div>
      </section>

      <section className="stories">
        <div className="story-head">
          <span>
            WHO GETS
            <br />
            WHAT.
          </span>
          <p>
            three people. one payment.
            <br />
            zero mystery meat.
          </p>
        </div>
        <article className="merchant-story">
          <small>01 / MERCHANT</small>
          <h3>
            pay for the thing
            <br />
            that pays you.
          </h3>
          <p>
            Net arrives instantly. Commission waits out the refund window. The fee never exceeds 1%.
          </p>
        </article>
        <article className="creator-story">
          <small>02 / CREATOR</small>
          <div>
            <h3>
              you moved
              <br />
              the product.
            </h3>
            <p>
              Your attribution link points to an on-chain settlement, not a dashboard’s pinky
              promise.
            </p>
          </div>
          <b>18%</b>
        </article>
        <article className="buyer-story">
          <small>03 / BUYER</small>
          <h3>
            one signature.
            <br />
            zero WBT.
          </h3>
          <div className="wallet-zero">
            WALLET GAS BALANCE <b>0.00 WBT</b>
          </div>
          <p>The relayer pays gas after you authorize the exact USDT amount.</p>
        </article>
      </section>

      <section className="trust">
        <div className="trust-title">
          <span>SHOW ME</span>
          <strong>THE RECEIPTS.</strong>
        </div>
        <div className="custody">
          {[
            "wallet-owned link",
            "order authorization",
            "OrderSettled event",
            "Arkiv entity match",
          ].map((x, i) => (
            <div key={x}>
              <b>0{i + 1}</b>
              <span>{x}</span>
              {i < 3 && <i>→</i>}
            </div>
          ))}
        </div>
        <div className="truth-grid">
          <article>
            <Stamp tone="green">WE KNOW</Stamp>
            <h3>money moved.</h3>
            <p>
              We match the Whitechain transaction, order ID, amount, creator, and merchant. Chain
              data wins every argument.
            </p>
          </article>
          <article>
            <Stamp>WE DON’T KNOW</Stamp>
            <h3>who’s behind the wallet.</h3>
            <p>
              Settlement does not prove audience authenticity. Wash trading and sybils still exist.
              Weirdly, crypto did not fix people.
            </p>
          </article>
        </div>
      </section>

      <section className="trending">
        <div className="section-header">
          <div>
            <span>LIVE / ARKIV-SYNCED</span>
            <h2>
              people are
              <br />
              selling things.
            </h2>
          </div>
          <button onClick={() => setView("campaigns")}>
            see all campaigns <Icon name="arrow" />
          </button>
        </div>
        <div className="campaign-preview">
          {campaigns.slice(0, 3).map((c, i) => (
            <CampaignRow key={c.id} campaign={c} rank={i + 1} />
          ))}
        </div>
      </section>

      <section className="sdk">
        <div>
          <span>DROP IT IN.</span>
          <h2>
            checkout without
            <br />
            the crypto costume.
          </h2>
          <p>Modal, inline, or compact. Theme it. The settlement stays verifiable.</p>
        </div>
        <div className="code-poster">
          <div>
            <i />
            <i />
            <i />
            <span>checkout.tsx</span>
          </div>
          <pre>
            <em>import</em> {"{ NumaCheckout }"} <em>from</em> <b>'@numa/pay'</b>
            {"\n\n"}&lt;<strong>NumaCheckout</strong>
            {"\n  "}orderUrl=<b>"/api/order"</b>
            {"\n  "}theme=<b>"dark"</b>
            {"\n"}/&gt;
          </pre>
          <span className="tape" />
        </div>
      </section>
    </main>
  );
}

function VerificationBadge({ state }: { state: string }) {
  if (state === "verified")
    return (
      <span className="badge verified">
        <Icon name="check" size={14} /> verified
      </span>
    );
  if (state === "unverified") return <span className="badge unverified">! unverified</span>;
  return <span className="badge unchecked">? unchecked</span>;
}

function CampaignRow({ campaign: c, rank }: { campaign: (typeof campaigns)[0]; rank: number }) {
  return (
    <button
      className="campaign-row"
      onClick={() => window.dispatchEvent(new CustomEvent("nav", { detail: "campaignDetail" }))}
    >
      <span className="row-rank">{String(rank).padStart(2, "0")}</span>
      <span className="row-name">
        <small>
          {c.id} / {c.category}
        </small>
        <strong>{c.name}</strong>
        <VerificationBadge state={c.verified} />
      </span>
      <span className="row-region">
        <small>REGION</small>
        {c.region}
      </span>
      <span className="row-offers">
        <small>LIVE OFFERS</small>↗ {c.offers}
      </span>
      <span className="row-ends">
        <small>ENDS IN</small>
        {c.ends}
      </span>
      <span className="row-commission">
        {c.commission}%<small>COMMISSION</small>
      </span>
      <span className="row-arrow">
        <Icon name="arrow" />
      </span>
    </button>
  );
}

function Campaigns() {
  const [query, setQuery] = useState("");
  const [minimum, setMinimum] = useState(10);
  const filtered = useMemo(
    () =>
      campaigns.filter(
        (c) =>
          c.commission >= minimum &&
          (c.name + c.category).toLowerCase().includes(query.toLowerCase()),
      ),
    [query, minimum],
  );
  return (
    <main className="page campaigns-page">
      <div className="page-poster">
        <span className="poster-code">MARKET / ARKIV ENTITIES</span>
        <h1>
          FIND SOMETHING
          <br />
          <em>WORTH SELLING.</em>
        </h1>
        <div className="rotated-note">
          SORTED BY
          <br />
          LIVE OFFERS ↗
        </div>
      </div>
      <div className="trending-strip">
        <b>TRENDING NOW</b>
        <span>01 NO SLEEP / DROP 08</span>
        <span>02 VINYL IS NOT DEAD</span>
        <span>03 RUN AFTER DARK</span>
      </div>
      <div className="market-layout">
        <aside className="filters">
          <h2>filter the noise.</h2>
          <label>
            <span>SEARCH</span>
            <div className="search">
              <Icon name="search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="name or category"
              />
            </div>
          </label>
          <label>
            <span>MIN. COMMISSION</span>
            <strong>{minimum}%</strong>
            <input
              type="range"
              min="0"
              max="40"
              step="5"
              value={minimum}
              onChange={(e) => setMinimum(+e.target.value)}
            />
          </label>
          <label>
            <span>CATEGORY</span>
            <select>
              <option>all categories</option>
              <option>streetwear</option>
              <option>music</option>
              <option>culture</option>
            </select>
          </label>
          <label>
            <span>REGION</span>
            <select>
              <option>anywhere</option>
              <option>global</option>
              <option>US</option>
              <option>EU</option>
            </select>
          </label>
          <button
            className="reset"
            onClick={() => {
              setQuery("");
              setMinimum(0);
            }}
          >
            reset everything
          </button>
        </aside>
        <section className="market-list">
          <div className="list-head">
            <span>{filtered.length} CAMPAIGNS / LIVE</span>
            <select aria-label="Sort">
              <option>live offers ↓</option>
              <option>commission ↓</option>
              <option>ending soon</option>
            </select>
          </div>
          {filtered.map((c, i) => (
            <CampaignRow key={c.id} campaign={c} rank={i + 1} />
          ))}
          {!filtered.length && (
            <div className="empty">
              <b>$0</b>
              <h3>nothing made the cut.</h3>
              <p>Relax the filters. This isn’t a moral failure.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Creator() {
  const [copied, setCopied] = useState(false);
  return (
    <main className="page creator-page">
      <section className="creator-hero">
        <div className="creator-id">
          <span>CREATOR / PUBLIC CARD</span>
          <h1>
            RIO
            <br />
            SANTOS
          </h1>
          <div className="address">
            <code>0x71c9…d03a</code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText("0x71c9d8f03a");
                setCopied(true);
              }}
            >
              <Icon name={copied ? "check" : "copy"} /> {copied ? "copied" : "copy"}
            </button>
            <button>
              <Icon name="external" /> explorer
            </button>
          </div>
        </div>
        <div className="score">
          <small>NUMA SCORE</small>
          <strong>87</strong>
          <span>/ 100</span>
          <p>based on settled sales, distinct payers, and merchant endorsements.</p>
          <button>how this is calculated ↗</button>
        </div>
        <Stamp tone="green">OPEN FOR WORK</Stamp>
      </section>
      <section className="creator-bio">
        <p>
          night runner, camera carrier, reluctant influencer. moving shoes, records, and things
          built to last.
        </p>
        <div>
          <span>streetwear</span>
          <span>running</span>
          <span>photography</span>
          <span>video / short</span>
        </div>
      </section>
      <section className="stat-grid">
        <div>
          <small>VERIFIED CONVERSIONS</small>
          <strong>142</strong>
          <span>chain-confirmed</span>
        </div>
        <div>
          <small>DISTINCT PAYERS</small>
          <strong>118</strong>
          <span>83% unique</span>
        </div>
        <div>
          <small>GROSS SETTLED</small>
          <strong>8,420.00</strong>
          <span>USDT</span>
        </div>
        <div>
          <small>COMMISSION EARNED</small>
          <strong>1,477.80</strong>
          <span>USDT</span>
        </div>
      </section>
      <section className="creator-details">
        <div className="sales-table">
          <div className="detail-head">
            <h2>recent verified sales</h2>
            <span>WHITECHAIN / LIVE</span>
          </div>
          {[
            ["42.00", "NO SLEEP / DROP 08", "2m ago", "0xa91…20c"],
            ["89.00", "RUN AFTER DARK", "3h ago", "0x8bc…771"],
            ["24.00", "VINYL IS NOT DEAD", "yesterday", "0xd03…01f"],
          ].map((x) => (
            <div className="sale-row" key={x[3]}>
              <strong>
                +{x[0]} <small>USDT</small>
              </strong>
              <span>{x[1]}</span>
              <span>{x[2]}</span>
              <button>
                {x[3]} <Icon name="external" size={15} />
              </button>
            </div>
          ))}
        </div>
        <aside className="endorsements">
          <div className="detail-head">
            <h2>endorsements</h2>
            <span>4.8 / 5</span>
          </div>
          <div className="stars">
            ★★★★<i>★</i>
          </div>
          <blockquote>
            “specific brief, clean traffic, zero nonsense.”
            <cite>
              — NULL OBJECTS <VerificationBadge state="verified" />
            </cite>
          </blockquote>
          <button>
            claims we ignored (and why) <span>3</span>
          </button>
        </aside>
      </section>
    </main>
  );
}

function Checkout() {
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const advance = () => {
    setError("");
    if (step === 0) setStep(1);
    else if (step === 1) {
      setStep(2);
      setTimeout(() => setStep(3), 1400);
    }
  };
  return (
    <main className="page checkout-page">
      <div className="checkout-brand">
        <Logo />
        <span>SECURE TESTNET CHECKOUT</span>
      </div>
      <section className="checkout-wrap">
        <div className="product">
          <div className="product-art">
            <span>
              NULL
              <br />
              OBJECTS
            </span>
            <b>08</b>
          </div>
          <span>NO-08 / FOOTWEAR</span>
          <h1>
            AFTERIMAGE
            <br />
            RUNNER
          </h1>
          <p>bone / acid sole · size 10</p>
          <strong>
            125.00 <small>USDT</small>
          </strong>
        </div>
        <div className="checkout-card">
          {step < 3 ? (
            <>
              <div className="checkout-head">
                <span>PAY WITH USDT</span>
                <b>125.00</b>
              </div>
              <div className="attribution">
                <span>CREATOR ATTRIBUTION</span>
                <strong>rio.santos / 0x71…d03</strong>
                <i>18% commission · held 7 days</i>
              </div>
              <details>
                <summary>
                  who gets what <span>show the split +</span>
                </summary>
                <SplitCalculator compact />
              </details>
              <div className="pay-steps">
                {["connect", "sign", "relaying", "settled"].map((s, i) => (
                  <span className={i <= step ? "on" : ""} key={s}>
                    <i>{i < step ? "✓" : i + 1}</i>
                    {s}
                  </span>
                ))}
              </div>
              {step === 1 && (
                <div className="signature-note">
                  <b>one signature. not a transaction.</b>
                  <p>
                    Authorize exactly 125.00 USDT to the numa router. The relayer pays the gas. Your
                    wallet needs 0 WBT.
                  </p>
                </div>
              )}
              {step === 2 && (
                <div className="relaying">
                  <i />
                  <b>sending to whitechain</b>
                  <span>do not close this window</span>
                </div>
              )}
              {error && (
                <div className="error-box">
                  <b>couldn’t simulate this payment.</b>
                  <p>No money moved. Check your wallet balance and network, then try again.</p>
                </div>
              )}
              {step < 2 && (
                <button className="pay-button" onClick={advance}>
                  {step === 0 ? "CONNECT WALLET" : "AUTHORIZE 125.00 USDT"} <Icon name="arrow" />
                </button>
              )}
              {step === 1 && (
                <button className="text-button" onClick={() => setError("SIMULATION_FAILED")}>
                  simulate an error
                </button>
              )}
              <p className="checkout-fine">
                testnet funds only · no gas prompt · chain-confirmed state
              </p>
            </>
          ) : (
            <div className="receipt">
              <div className="receipt-notch" />
              <Logo />
              <span>ORDER / NMA-8821</span>
              <h2>
                125.00 <small>USDT</small>
              </h2>
              <Stamp tone="green">SETTLED</Stamp>
              <div className="receipt-lines">
                <p>
                  <span>merchant / paid</span>
                  <b>101.25</b>
                </p>
                <p>
                  <span>creator / held</span>
                  <b>22.50</b>
                </p>
                <p>
                  <span>protocol fee</span>
                  <b>1.25</b>
                </p>
              </div>
              <div className="chain-check">
                <Icon name="check" /> chain-confirmed · block 18,491,202
              </div>
              <button>
                0xa91f…20c8 <Icon name="external" />
              </button>
              <p>creator commission releases in 6d 23h 59m</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function CampaignDetail() {
  const [offerOpen, setOfferOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [ask, setAsk] = useState(18);
  const [signed, setSigned] = useState(false);
  return (
    <main className="page detail-page">
      <section className="campaign-poster">
        <div className="campaign-back">
          <button
            onClick={() =>
              window.dispatchEvent(new CustomEvent("nav", { detail: "campaigns" }))
            }
          >
            ← ALL CAMPAIGNS
          </button>
          <span>SP-008 / ACTIVE</span>
        </div>
        <div className="poster-noise" aria-hidden="true">
          08
        </div>
        <div className="campaign-title">
          <VerificationBadge state="verified" />
          <h1>
            NO SLEEP
            <br />
            <em>DROP 08.</em>
          </h1>
          <p>
            reflective footwear for people who consider sunrise a deadline. Global campaign by NULL
            OBJECTS.
          </p>
        </div>
        <div className="campaign-ask">
          <span>CREATOR COMMISSION</span>
          <strong>18%</strong>
          <small>MAX 20% · 42 LIVE OFFERS</small>
          <button onClick={() => setOfferOpen(true)}>
            SUBMIT AN OFFER <Icon name="arrow" />
          </button>
        </div>
      </section>
      <section className="campaign-terms">
        <div><span>REGION</span><b>GLOBAL</b></div>
        <div><span>ENDS IN</span><b>2d 14h 08m</b></div>
        <div><span>REFUND WINDOW</span><b>7 DAYS</b></div>
        <div><span>STATUS</span><b className="green-copy">● ACTIVE</b></div>
      </section>
      <section className="campaign-body">
        <div className="campaign-copy">
          <span>THE BRIEF / ARKIV-SYNCED</span>
          <h2>make night look like the sensible option.</h2>
          <p>
            Show the Afterimage Runner in motion after dark. Product must be visible, but a product
            close-up is not a personality. Short video and editorial photography preferred.
          </p>
          <div className="do-dont">
            <div><b>DO</b><p>show real use, disclose the relationship, link the exact product.</p></div>
            <div><b>DON’T</b><p>buy your own link, promise medical benefits, or submit bot traffic as a personality trait.</p></div>
          </div>
          <div className="campaign-timeline">
            {["campaign registered","offers close","campaign ends","last commission releases"].map((x,i)=><div key={x}><i className={i===0?"done":""}/><span>{x}</span><small>{["APR 03","APR 21","APR 24","MAY 01"][i]}</small></div>)}
          </div>
        </div>
        <aside className="detail-calc"><h3>what one sale does.</h3><SplitCalculator compact/><p><Icon name="check"/> Money state is read from Whitechain.</p><p className="arkiv-sync"><i/> Listing terms synced from Arkiv 18s ago.</p></aside>
      </section>
      {offerOpen && (
        <div className="offer-modal" role="dialog" aria-modal="true" aria-label="Submit offer">
          <button className="modal-scrim" onClick={() => setOfferOpen(false)} aria-label="Close" />
          <section>
            <div className="offer-modal-head"><div><span>NO SLEEP / DROP 08</span><h2>{signed ? "offer published." : "make your ask."}</h2></div><button onClick={() => setOfferOpen(false)}><Icon name="close"/></button></div>
            {!signed ? <>
              <div className="offer-progress">{["channel + audience","commission + reach","review + sign"].map((x,i)=><button onClick={()=>setStep(i+1)} className={step===i+1?"active":step>i+1?"done":""} key={x}><i>{step>i+1?"✓":i+1}</i>{x}</button>)}</div>
              <div className="offer-form">
                {step===1&&<><label>CHANNEL<select defaultValue=""><option value="" disabled>choose a channel</option><option>short video</option><option>newsletter</option><option>live stream</option></select><small>where the product will actually appear.</small></label><label>AUDIENCE<textarea placeholder="night runners, streetwear collectors, camera people who stay out too late" /></label><div className="validation-note">Keep this specific. “everyone” is not an audience.</div></>}
                {step===2&&<><label className="ask-slider">YOUR ASK<strong>{ask}% <small>{ask*100} BPS</small></strong><input type="range" min="1" max="20" value={ask} onChange={e=>setAsk(+e.target.value)}/><span>campaign maximum: 20%</span></label><label>EXPECTED REACH<input type="number" defaultValue="12000"/><small>an estimate, not a settlement. it does not affect earnings.</small></label></>}
                {step===3&&<div className="offer-review"><div><span>CHANNEL</span><b>short video</b></div><div><span>AUDIENCE</span><b>night runners + streetwear</b></div><div><span>ASK</span><b>{ask}% / {ask*100} BPS</b></div><div><span>EXPECTED REACH</span><b>12,000</b></div><aside><b>ARKIV WRITE / tGLM REQUIRED</b><p>Your wallet signs an entity publish. This does not move USDT.</p><button>NEED TEST GAS? OPEN FAUCET ↗</button></aside></div>}
              </div>
              <div className="offer-modal-actions"><button disabled={step===1} onClick={()=>setStep(step-1)}>BACK</button><button className="hard-button" onClick={()=>step<3?setStep(step+1):setSigned(true)}>{step<3?"CONTINUE":"REVIEW + SIGN"} <Icon name="arrow"/></button></div>
            </>:<div className="offer-success"><Stamp tone="green">PUBLISHED</Stamp><strong>71h 59m</strong><span>until this offer expires</span><p>Arkiv accepted your offer. The merchant can now approve or reject it. Approval will require a separate Whitechain transaction.</p><div><Icon name="check"/> entity owner matches 0x71c…d03a</div><button onClick={()=>setOfferOpen(false)}>DONE</button></div>}
          </section>
        </div>
      )}
    </main>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      verb: "campaign",
      title: "merchant sets the terms.",
      copy: "Commission, region, deadline, and a payout signer are registered. Money logic goes to Whitechain; the listing goes to Arkiv.",
      chain: "WHITECHAIN + ARKIV",
    },
    {
      n: "02",
      verb: "offer",
      title: "creator makes the ask.",
      copy: "Channel, audience, expected reach, and commission ask. The offer expires in 72 hours. Click forecasts remain forecasts.",
      chain: "ARKIV · tGLM WRITE",
    },
    {
      n: "03",
      verb: "approve",
      title: "merchant says yes.",
      copy: "Approval permits this creator to attribute sales. The on-chain approval is the source of truth; the decision entity explains it.",
      chain: "WHITECHAIN + ARKIV",
    },
    {
      n: "04",
      verb: "link",
      title: "one code. no surveillance.",
      copy: "The creator shares a wallet-owned attribution link. Clicks can be counted, but they never become earnings.",
      chain: "ARKIV · tGLM WRITE",
    },
    {
      n: "05",
      verb: "pay",
      title: "buyer signs once.",
      copy: "The buyer authorizes an exact USDT amount. A relayer submits it and pays gas. The buyer needs zero WBT.",
      chain: "WHITECHAIN · RELAYER",
    },
    {
      n: "06",
      verb: "settle",
      title: "the receipt wins.",
      copy: "Merchant net lands now. Creator commission is held through the refund window, then released. Protocol fee is never above 1%.",
      chain: "WHITECHAIN · CHAIN-CONFIRMED",
    },
  ];
  return (
    <main className="page how-page">
      <section className="flow-intro">
        <span>LIFECYCLE / SIX MOVES</span>
        <h1>
          FROM “MAYBE”
          <br />
          TO <em>MONEY.</em>
        </h1>
        <p>
          Listings live on Arkiv. Money lives on Whitechain. We keep the border loud because quiet
          infrastructure lies by omission.
        </p>
      </section>
      <section className="horizontal-story" aria-label="Numa lifecycle">
        {steps.map((step) => (
          <article key={step.n}>
            <div className="step-top">
              <b>{step.n}</b>
              <span>{step.verb}</span>
            </div>
            <div className={`step-mark mark-${step.n}`}>{step.n === "06" ? "$" : "↗"}</div>
            <h2>{step.title}</h2>
            <p>{step.copy}</p>
            <small>{step.chain}</small>
          </article>
        ))}
      </section>
      <section className="lifecycle-strip">
        <div>
          <span className="status live">● ACTIVE</span>
          <p>Offers open. Links can settle.</p>
        </div>
        <div>
          <span className="status paused">Ⅱ PAUSED</span>
          <p>Existing state stays visible. New offers stop.</p>
        </div>
        <div>
          <span className="status ended">■ ENDED</span>
          <p>No new links or offers. Old receipts remain receipts.</p>
        </div>
      </section>
    </main>
  );
}

function Leaderboard() {
  const leaders = [
    { rank: 1, name: "RIO SANTOS", address: "0x71…d03", score: 87, sales: 142, gross: "8,420" },
    { rank: 2, name: "MARA.WAV", address: "0x39…a18", score: 84, sales: 119, gross: "7,103" },
    { rank: 3, name: "NOAH K.", address: "0x0b…910", score: 79, sales: 98, gross: "5,441" },
    { rank: 4, name: "DEAD AIR", address: "0x82…c02", score: 76, sales: 91, gross: "4,882" },
    { rank: 5, name: "MOTEL TV", address: "0xfa…811", score: 71, sales: 76, gross: "3,901" },
  ];
  return (
    <main className="page leaderboard-page">
      <section className="leader-head">
        <div>
          <span>VERIFIED ON-CHAIN ONLY</span>
          <h1>
            THE PEOPLE WHO
            <br />
            <em>ACTUALLY SOLD.</em>
          </h1>
        </div>
        <div className="leader-filters">
          <label>
            CAMPAIGN
            <select>
              <option>all campaigns</option>
              <option>NO SLEEP / DROP 08</option>
            </select>
          </label>
          <label>
            WINDOW
            <select>
              <option>last 30 days</option>
              <option>last 7 days</option>
              <option>all time</option>
            </select>
          </label>
        </div>
      </section>
      <section className="podium">
        {[leaders[1], leaders[0], leaders[2]].map((leader) => (
          <article className={`podium-${leader.rank}`} key={leader.rank}>
            <span>0{leader.rank}</span>
            <strong>{leader.score}</strong>
            <h2>{leader.name}</h2>
            <code>{leader.address}</code>
            <p>{leader.sales} settled sales</p>
            {leader.rank === 1 && <Stamp tone="green">REAL MONEY</Stamp>}
          </article>
        ))}
      </section>
      <section className="leader-table">
        <div className="leader-row leader-labels">
          <span>RANK / CREATOR</span>
          <span>SCORE</span>
          <span>VERIFIED CONVERSIONS</span>
          <span>30D SIGNAL</span>
          <span>GROSS SETTLED</span>
        </div>
        {leaders.map((leader) => (
          <button className="leader-row" key={leader.rank}>
            <span>
              <b>0{leader.rank}</b> {leader.name} <code>{leader.address}</code>
            </span>
            <strong>{leader.score}</strong>
            <span>{leader.sales}</span>
            <span className="sparkline">▁▂▃▂▄▅▄▆▇</span>
            <span>{leader.gross} USDT</span>
          </button>
        ))}
      </section>
      <aside className="honesty-note">
        <b>WHAT THIS RANKING DOESN’T SAY</b>
        <p>
          A high score means more verified sales and distinct payers. It does not prove audience
          authenticity. We have not yet invented a number that can read minds.
        </p>
      </aside>
    </main>
  );
}

function AppSidebar({
  role,
  active,
  setActive,
}: {
  role: "creator" | "merchant";
  active: string;
  setActive: (value: string) => void;
}) {
  const creatorItems = [
    "overview",
    "discover",
    "offers",
    "links",
    "invites",
    "earnings",
    "profile",
  ];
  const merchantItems = [
    "overview",
    "campaigns",
    "offers",
    "creators",
    "invites",
    "orders",
    "settings",
  ];
  const items = role === "creator" ? creatorItems : merchantItems;
  return (
    <aside className="app-sidebar">
      <div>
        <span>{role.toUpperCase()} APP</span>
        <b>{role === "creator" ? "rio.santos" : "NULL OBJECTS"}</b>
      </div>
      <nav>
        {items.map((item, i) => (
          <button
            className={active === item ? "active" : ""}
            onClick={() => setActive(item)}
            key={item}
          >
            <small>0{i + 1}</small>
            {item}
            {item === "offers" && <i>{role === "merchant" ? 6 : 3}</i>}
          </button>
        ))}
      </nav>
      <div className="two-chain">
        <p>
          <i className="green-dot" /> Whitechain <span>money</span>
        </p>
        <p>
          <i className="grey-dot" /> Arkiv <span>listings</span>
        </p>
      </div>
    </aside>
  );
}

function CreatorApp() {
  const [tab, setTab] = useState("overview");
  const [copied, setCopied] = useState("");
  const content =
    tab === "profile" ? (
      <section className="app-panel profile-panel">
        <div className="panel-title"><div><span>PROFILE / WALLET-OWNED</span><h2>say enough.<br />not everything.</h2></div><span className="status live">● PUBLISHED</span></div>
        <div className="profile-layout">
          <div className="profile-form">
            <label>DISPLAY NAME<input defaultValue="RIO SANTOS"/></label>
            <label>BIO<textarea defaultValue="night runner, camera carrier, reluctant influencer. moving shoes, records, and things built to last."/></label>
            <label>CHANNEL<select><option>short video</option><option>newsletter</option><option>live stream</option></select></label>
            <label>NICHE TAGS<div className="tag-input"><span>streetwear ×</span><span>running ×</span><span>photography ×</span><input placeholder="+ add tag"/></div></label>
            <label className="commission-field">MINIMUM ASK<strong>12% <small>1200 BPS</small></strong><input type="range" min="1" max="50" defaultValue="12"/></label>
            <label className="open-toggle"><span><b>OPEN FOR WORK</b><small>merchants can send invites.</small></span><input type="checkbox" defaultChecked/><i/></label>
            <div className="network-action"><div><b>PUBLISH TO ARKIV</b><p>Updates are optimistic while the index catches up. Requires tGLM.</p></div><button className="hard-button">REVIEW + SIGN</button></div>
          </div>
          <aside className="profile-preview"><span>PUBLIC PREVIEW</span><div><Stamp tone="green">OPEN</Stamp><strong>87</strong><h3>RIO<br/>SANTOS</h3><p>streetwear / running / photography</p><code>0x71c9…d03a</code></div><p>Share image exports at 1200 × 630 with the same score and chain-confirmed label.</p></aside>
        </div>
      </section>
    ) : tab === "invites" ? (
      <section className="app-panel invites-panel">
        <div className="panel-title"><div><span>INVITES / ARKIV</span><h2>they asked.<br />you decide.</h2></div><span className="wizard-count">02</span></div>
        {[
          ["NULL OBJECTS","verified","NO SLEEP / DROP 08","18%","31h 08m","active"],
          ["NEON PRESS","unchecked","READ BANNED BOOKS","24%","47h 12m","active"],
          ["ARCHIVE FM","verified","VINYL IS NOT DEAD","20%","expired","expired"],
        ].map(invite=><article className={`invite-row ${invite[5]}`} key={invite[0]}><div><VerificationBadge state={invite[1]}/><h3>{invite[0]}</h3><p>{invite[2]}</p></div><div><span>COMMISSION</span><b>{invite[3]}</b></div><div><span>EXPIRES</span><b>{invite[4]}</b></div><div>{invite[5]==="expired"?<span className="status ended">EXPIRED</span>:<><button>DECLINE</button><button>ACCEPT</button></>}</div></article>)}
      </section>
    ) : tab === "discover" || tab === "offers" ? (
      <section className="app-panel creator-discover">
        <div className="panel-title"><div><span>{tab === "offers" ? "YOUR OFFERS / 03" : "DISCOVER / TRENDING"}</span><h2>{tab === "offers" ? <>waiting is part<br/>of the pitch.</> : <>pick something<br/>you’d actually use.</>}</h2></div><button className="outline-button">FILTER</button></div>
        {campaigns.map((c,i)=><div className="creator-campaign-row" key={c.id}><span>0{i+1}</span><div><small>{c.category} / {c.region}</small><h3>{c.name}</h3><VerificationBadge state={c.verified}/></div><div><small>{tab==="offers"?"YOUR ASK":"COMMISSION"}</small><b>{tab==="offers"?Math.max(10,c.commission-2):c.commission}%</b></div><div><small>{tab==="offers"?"EXPIRES":"ENDS IN"}</small><b>{tab==="offers"?["18h","2d 3h","2d 11h","expired"][i]:c.ends}</b></div><button onClick={()=>window.dispatchEvent(new CustomEvent("nav",{detail:"campaignDetail"}))}>{tab==="offers"?"VIEW":"OFFER"} <Icon name="arrow"/></button></div>)}
      </section>
    ) : tab === "links" ? (
      <section className="app-panel links-panel">
        <div className="panel-title">
          <div>
            <span>ATTRIBUTION</span>
            <h2>
              links that know
              <br />
              when money moved.
            </h2>
          </div>
          <button className="hard-button">+ CREATE LINK</button>
        </div>
        <div className="link-builder">
          <label>
            CAMPAIGN
            <select>
              <option>NO SLEEP / DROP 08</option>
              <option>RUN AFTER DARK</option>
            </select>
          </label>
          <label>
            EXPIRES
            <select>
              <option>7 days</option>
              <option>30 days</option>
              <option>campaign end</option>
            </select>
          </label>
          <button>
            GENERATE ON ARKIV <Icon name="arrow" />
          </button>
        </div>
        <div className="data-list-head">
          <span>CODE / CAMPAIGN</span>
          <span>CLICKS</span>
          <span>SETTLED</span>
          <span>EARNED</span>
          <span />
        </div>
        {[
          ["RIO-08-X", "NO SLEEP / DROP 08", "2,401", "18", "420.30"],
          ["AFTERDARK", "RUN AFTER DARK", "881", "11", "118.80"],
        ].map((link) => (
          <div className="data-list-row" key={link[0]}>
            <span>
              <code>{link[0]}</code>
              <small>{link[1]}</small>
            </span>
            <span>
              {link[2]}
              <small>$0 from clicks</small>
            </span>
            <span>
              {link[3]}
              <small>chain-confirmed</small>
            </span>
            <strong>{link[4]} USDT</strong>
            <button onClick={() => setCopied(link[0])}>
              <Icon name={copied === link[0] ? "check" : "copy"} />
            </button>
          </div>
        ))}
        <div className="qr-card">
          <div className="fake-qr" aria-label="QR code">
            <span>nu</span>
          </div>
          <div>
            <small>LINK PREVIEW</small>
            <code>numa.pay/RIO-08-X</code>
            <p>expires in 6d 14h · Arkiv-owned</p>
          </div>
          <button>DOWNLOAD SVG</button>
        </div>
      </section>
    ) : tab === "earnings" ? (
      <section className="app-panel earnings-panel">
        <div className="panel-title">
          <div>
            <span>WHITECHAIN / LIVE</span>
            <h2>
              money, without
              <br />
              the motivational quote.
            </h2>
          </div>
          <button className="outline-button">EXPORT CSV</button>
        </div>
        <div className="earnings-stats">
          <div>
            <span>RELEASED</span>
            <b>1,205.30</b>
            <small>USDT</small>
          </div>
          <div>
            <span>HELD</span>
            <b>272.50</b>
            <small>USDT</small>
          </div>
          <div>
            <span>TOTAL EARNED</span>
            <b>1,477.80</b>
            <small>USDT</small>
          </div>
        </div>
        <div className="chart">
          <div className="chart-y">
            <span>300</span>
            <span>200</span>
            <span>100</span>
            <span>0</span>
          </div>
          <svg viewBox="0 0 700 220" preserveAspectRatio="none">
            <path d="M0 190 L90 160 L180 175 L270 95 L360 125 L450 60 L540 80 L630 20 L700 48" />
            <path
              className="chart-held"
              d="M0 210 L90 200 L180 190 L270 170 L360 160 L450 140 L540 130 L630 120 L700 105"
            />
          </svg>
          <div className="chart-labels">
            <span>APR 01</span>
            <span>APR 08</span>
            <span>APR 15</span>
            <span>APR 22</span>
            <span>NOW</span>
          </div>
        </div>
        <div className="release-callout">
          <span>NEXT RELEASE</span>
          <b>42.50 USDT</b>
          <strong>18h 09m 22s</strong>
          <p>Order NMA-8821 · refund window ends automatically</p>
        </div>
      </section>
    ) : (
      <section className="app-panel overview-panel">
        <div className="app-greeting">
          <span>MONDAY / 09:41 UTC</span>
          <h1>
            YOU MADE
            <br />
            <em>272.50</em> WHILE
            <br />
            NOT CLICKING.
          </h1>
        </div>
        <div className="dashboard-stats">
          <div className="held">
            <span>HELD</span>
            <b>272.50</b>
            <small>USDT · 7 orders</small>
          </div>
          <div>
            <span>RELEASED</span>
            <b>1,205.30</b>
            <small>USDT · all time</small>
          </div>
          <div>
            <span>NEXT RELEASE</span>
            <b>18:09:22</b>
            <small>42.50 USDT</small>
          </div>
        </div>
        <div className="dashboard-grid">
          <article>
            <div className="panel-head">
              <h3>live offers</h3>
              <button onClick={() => setTab("offers")}>view all →</button>
            </div>
            {["NO SLEEP / DROP 08", "VINYL IS NOT DEAD", "READ BANNED BOOKS"].map((x, i) => (
              <div className="mini-row" key={x}>
                <span>
                  <b>{x}</b>
                  <small>
                    {[18, 24, 30][i]}% ask · expires {["18h", "2d", "2d 11h"][i]}
                  </small>
                </span>
                <span className={i === 0 ? "status live" : "status paused"}>
                  {i === 0 ? "APPROVED" : "PENDING"}
                </span>
              </div>
            ))}
          </article>
          <article>
            <div className="panel-head">
              <h3>invites / 02</h3>
              <button>see inbox →</button>
            </div>
            <div className="invite-card">
              <VerificationBadge state="verified" />
              <h4>NULL OBJECTS wants you.</h4>
              <p>NO SLEEP / DROP 08 · 18% · expires in 31h</p>
              <div>
                <button>DECLINE</button>
                <button>ACCEPT</button>
              </div>
            </div>
          </article>
          <article className="checklist">
            <div className="panel-head">
              <h3>quick start</h3>
              <span>3 / 4</span>
            </div>
            {["profile published", "first offer sent", "link created", "first sale settled"].map(
              (x, i) => (
                <p className={i < 3 ? "done" : ""} key={x}>
                  <i>{i < 3 ? "✓" : "4"}</i>
                  {x}
                </p>
              ),
            )}
          </article>
        </div>
      </section>
    );
  return (
    <main className="product-app">
      <AppSidebar role="creator" active={tab} setActive={setTab} />
      {content}
    </main>
  );
}

function MerchantApp() {
  const [tab, setTab] = useState("overview");
  const [wizard, setWizard] = useState(1);
  const [commission, setCommission] = useState(18);
  const [approved, setApproved] = useState("");
  const offers = [
    { name: "RIO SANTOS", score: 87, ask: 18, reach: "12–18k", channel: "short video" },
    { name: "MARA.WAV", score: 84, ask: 20, reach: "8–11k", channel: "newsletter" },
    { name: "DEAD AIR", score: 76, ask: 15, reach: "25–30k", channel: "live stream" },
  ];
  const content =
    tab === "creators" ? (
      <section className="app-panel discovery-panel">
        <div className="panel-title">
          <div><span>CREATOR DISCOVERY / ARKIV</span><h2>find the person.<br />ignore the following.</h2></div>
          <button className="outline-button">COMPARE / 02</button>
        </div>
        <div className="discovery-filters">
          <label><Icon name="search"/><input placeholder="niche, address, or channel"/></label>
          <select><option>all channels</option><option>short video</option><option>newsletter</option></select>
          <select><option>max ask: any</option><option>20% or less</option><option>15% or less</option></select>
          <label className="toggle-label"><input type="checkbox" defaultChecked/><i/> open only</label>
        </div>
        <div className="creator-results">
          {[
            ["87","RIO SANTOS","streetwear · running","142","18%","short video"],
            ["84","MARA.WAV","music · culture","119","20%","newsletter"],
            ["76","DEAD AIR","gaming · tech","91","15%","live stream"],
            ["—","NEW STATIC","photography · design","0","12%","editorial"],
          ].map((person,i)=><article key={person[1]}>
            <label><input type="checkbox" defaultChecked={i<2}/><i/></label>
            <div className={person[0]==="—"?"result-score null": "result-score"}>{person[0]}</div>
            <div><h3>{person[1]}</h3><p>{person[2]} · {person[5]}</p>{person[0]==="—"&&<small>No verified sales history yet.</small>}</div>
            <div><span>VERIFIED SALES</span><b>{person[3]}</b></div>
            <div><span>MIN. ASK</span><b>{person[4]}</b></div>
            <button>INVITE <Icon name="arrow"/></button>
          </article>)}
        </div>
        <aside className="compare-drawer">
          <div><span>COMPARE / 02</span><button>clear</button></div>
          <table><thead><tr><th>CREATOR</th><th>SCORE</th><th>SALES</th><th>DISTINCT PAYERS</th><th>GROSS</th><th>ENDORSEMENTS</th></tr></thead><tbody><tr><td>RIO SANTOS</td><td>87</td><td>142</td><td>118</td><td>8,420 USDT</td><td>4.8 / 21</td></tr><tr><td>MARA.WAV</td><td>84</td><td>119</td><td>104</td><td>7,103 USDT</td><td>4.7 / 18</td></tr></tbody></table>
          <p>Scores compare verified history. They do not prove audience authenticity.</p>
        </aside>
      </section>
    ) : tab === "campaigns" ? (
      <section className="app-panel wizard-panel">
        <div className="panel-title">
          <div>
            <span>NEW CAMPAIGN</span>
            <h2>
              set the terms.
              <br />
              then live with them.
            </h2>
          </div>
          <span className="wizard-count">0{wizard} / 04</span>
        </div>
        <div className="wizard-steps">
          {["basics", "commission", "schedule", "publish"].map((x, i) => (
            <button
              className={wizard === i + 1 ? "active" : wizard > i + 1 ? "done" : ""}
              onClick={() => setWizard(i + 1)}
              key={x}
            >
              <i>{wizard > i + 1 ? "✓" : i + 1}</i>
              {x}
            </button>
          ))}
        </div>
        <div className="wizard-body">
          {wizard === 1 && (
            <>
              <label>
                CAMPAIGN NAME
                <input defaultValue="NO SLEEP / DROP 09" />
              </label>
              <label>
                DESCRIPTION
                <textarea defaultValue="A late-night footwear drop for runners who don't ask permission from daylight." />
              </label>
              <div className="form-pair">
                <label>
                  CATEGORY
                  <select>
                    <option>streetwear</option>
                  </select>
                </label>
                <label>
                  REGION
                  <select>
                    <option>global</option>
                  </select>
                </label>
              </div>
            </>
          )}
          {wizard === 2 && (
            <>
              <label className="commission-field">
                MAXIMUM COMMISSION<strong>{commission}%</strong>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={commission}
                  onChange={(e) => setCommission(+e.target.value)}
                />
                <small>hard maximum: 50%. creator asks may be lower.</small>
              </label>
              <div className="fee-example">
                <span>ON A 100.00 USDT SALE</span>
                <p>
                  merchant receives <b>{(99 - commission).toFixed(2)}</b>
                </p>
                <p>
                  creator can earn up to <b>{commission.toFixed(2)}</b>
                </p>
                <p>
                  protocol fee <b>1.00 max</b>
                </p>
              </div>
            </>
          )}
          {wizard === 3 && (
            <>
              <div className="form-pair">
                <label>
                  START DATE
                  <input type="date" defaultValue="2026-04-20" />
                </label>
                <label>
                  END DATE
                  <input type="date" defaultValue="2026-05-30" />
                </label>
              </div>
              <div className="warning-note">
                ! Maximum practical window is about 175 days due to authorization limits. Long
                campaigns are easier to pause than to explain.
              </div>
              <label>
                PAYOUT SIGNER
                <input defaultValue="0x4be019c0209A7E8839D45b2B8A01" />
              </label>
            </>
          )}
          {wizard === 4 && (
            <div className="publish-steps">
              <div>
                <span>01</span>
                <b>REGISTER ON WHITECHAIN</b>
                <p>Campaign terms and payout signer. Requires WBT gas.</p>
                <i>money rules</i>
              </div>
              <div>
                <span>02</span>
                <b>PUBLISH TO ARKIV</b>
                <p>Discoverable listing. Requires tGLM gas.</p>
                <i>marketplace listing</i>
              </div>
              <p>Two networks. Two confirmations. We will not pretend otherwise.</p>
            </div>
          )}
        </div>
        <div className="wizard-actions">
          <button disabled={wizard === 1} onClick={() => setWizard(wizard - 1)}>
            BACK
          </button>
          <button className="hard-button" onClick={() => setWizard(Math.min(4, wizard + 1))}>
            {wizard === 4 ? "EXPLAIN + CONFIRM" : "CONTINUE"} <Icon name="arrow" />
          </button>
        </div>
      </section>
    ) : tab === "offers" ? (
      <section className="app-panel offer-review">
        <div className="panel-title">
          <div>
            <span>NO SLEEP / DROP 08</span>
            <h2>
              six asks.
              <br />
              three look real.
            </h2>
          </div>
          <button className="outline-button">SELECT ALL</button>
        </div>
        <div className="offer-columns">
          <div>
            {offers.map((offer) => (
              <article className={approved === offer.name ? "approved" : ""} key={offer.name}>
                <div className="offer-score">{offer.score}</div>
                <div>
                  <h3>{offer.name}</h3>
                  <p>
                    {offer.channel} · expected reach {offer.reach}
                  </p>
                  <span>{offer.ask}% ASK · EXPIRES IN 31H</span>
                </div>
                <div className="offer-actions">
                  <button>REJECT</button>
                  <button onClick={() => setApproved(offer.name)}>
                    {approved === offer.name ? "APPROVED ✓" : "APPROVE"}
                  </button>
                </div>
              </article>
            ))}
          </div>
          <aside>
            <span>WHAT APPROVAL PERMITS</span>
            <h3>attributed sales. nothing else.</h3>
            <p>
              This creator can create links for this campaign. Approval does not move funds or
              guarantee reach.
            </p>
            <div>
              <b>WHITECHAIN</b>
              <span>approveCreator()</span>
              <small>estimated 0.003 WBT</small>
            </div>
            <div>
              <b>ARKIV</b>
              <span>decision entity</span>
              <small>estimated 0.01 tGLM</small>
            </div>
          </aside>
        </div>
      </section>
    ) : (
      <section className="app-panel merchant-overview">
        <div className="app-greeting">
          <span>MERCHANT / NULL OBJECTS</span>
          <h1>
            SIX OFFERS.
            <br />
            <em>ONE SALE</em>
            <br />
            SINCE COFFEE.
          </h1>
        </div>
        <div className="dashboard-stats">
          <div>
            <span>GROSS SETTLED / 30D</span>
            <b>14,882.40</b>
            <small>USDT</small>
          </div>
          <div className="held">
            <span>CREATOR COMMISSION HELD</span>
            <b>1,902.10</b>
            <small>USDT · 38 orders</small>
          </div>
          <div>
            <span>ACTIVE CAMPAIGNS</span>
            <b>04</b>
            <small>+ 1 paused</small>
          </div>
        </div>
        <div className="dashboard-grid">
          <article>
            <div className="panel-head">
              <h3>offers need a decision</h3>
              <button onClick={() => setTab("offers")}>review 06 →</button>
            </div>
            {offers.map((x) => (
              <div className="mini-row" key={x.name}>
                <span>
                  <b>{x.name}</b>
                  <small>
                    {x.score} score · {x.ask}% ask
                  </small>
                </span>
                <button className="row-action">REVIEW</button>
              </div>
            ))}
          </article>
          <article>
            <div className="panel-head">
              <h3>settlements / live</h3>
              <span className="chain-label">● CHAIN</span>
            </div>
            {["125.00 / NMA-8821", "42.00 / NMA-8819", "89.00 / NMA-8811"].map((x, i) => (
              <div className="mini-row" key={x}>
                <span>
                  <b>{x} USDT</b>
                  <small>
                    {["12s", "8m", "31m"][i]} ago · 0xa{i + 3}…c0{i}
                  </small>
                </span>
                <span className="status live">SETTLED</span>
              </div>
            ))}
          </article>
          <article className="refund-card">
            <div className="panel-head">
              <h3>refund queue</h3>
              <Stamp>MODEL PENDING</Stamp>
            </div>
            <b>03</b>
            <p>
              Designed state only. Contract refund mechanics are still being decided. No buttons
              pretending otherwise.
            </p>
          </article>
        </div>
      </section>
    );
  return (
    <main className="product-app">
      <AppSidebar role="merchant" active={tab} setActive={setTab} />
      {content}
    </main>
  );
}

const relayerErrors = [
  [
    "ORDER_EXPIRED",
    "this price quote expired.",
    "We’re fetching a fresh order. Review the amount before signing again.",
  ],
  [
    "BAD_AUTH_WINDOW",
    "the authorization window is invalid.",
    "No money moved. Refresh the order so the time window can be rebuilt.",
  ],
  [
    "BAD_SELF_PURCHASE",
    "you can’t buy through your own creator link.",
    "Use the merchant’s direct checkout or a different buyer wallet.",
  ],
  [
    "BAD_MERCHANT_SIG",
    "the merchant signature didn’t check out.",
    "No money moved. The merchant needs to issue a fresh order.",
  ],
  [
    "BAD_BUYER_AUTH",
    "your authorization could not be verified.",
    "Check the amount and connected wallet before signing a fresh authorization.",
  ],
  [
    "DUPLICATE",
    "this order already exists.",
    "Check the existing transaction and receipt instead of paying twice.",
  ],
  [
    "GAS_PRICE_TOO_HIGH",
    "network gas is above the relayer limit.",
    "Your authorization is safe. Wait for gas to settle; do not sign again yet.",
  ],
  [
    "DAILY_CAP_EXCEEDED",
    "today’s relayer limit has been reached.",
    "No money moved. Try tomorrow or ask the merchant for another payment path.",
  ],
  [
    "ADDRESS_LIMIT_EXCEEDED",
    "this wallet reached its relayer limit.",
    "No money moved. Limits reset automatically; signing again will not help.",
  ],
  [
    "INSUFFICIENT_RELAYER_BALANCE",
    "the relayer needs a refill.",
    "Your USDT did not move. The merchant has been notified.",
  ],
  [
    "SIMULATION_FAILED",
    "the payment simulation failed.",
    "No money moved. Check balance and network before creating a fresh order.",
  ],
  [
    "TX_REVERTED",
    "whitechain rejected the transaction.",
    "Check the explorer for the exact reason before trying anything else.",
  ],
  [
    "TX_TIMEOUT",
    "confirmation is taking longer than expected.",
    "Check the explorer before retrying. A second payment could duplicate the first.",
  ],
];

function DemoShop() {
  const [widget, setWidget] = useState(false);
  return (
    <main className="demo-shop">
      <header>
        <div className="null-logo">
          NULL
          <br />
          OBJECTS
        </div>
        <nav>
          <button>new drop</button>
          <button>footwear</button>
          <button>field notes</button>
        </nav>
        <span>CART / 01</span>
      </header>
      <section className="demo-hero">
        <div className="shoe-object">
          <span>NO—08</span>
          <b>↗</b>
        </div>
        <div className="demo-copy">
          <span>AFTERIMAGE / RUNNER 08</span>
          <h1>
            BUILT FOR
            <br />
            THE HOURS
            <br />
            <em>AFTER.</em>
          </h1>
          <p>Bone ripstop. Acid outsole. Reflective seams for bad decisions made after sunset.</p>
          <div>
            <strong>125.00 USDT</strong>
            <button onClick={() => setWidget(true)}>
              BUY THE SHOE <Icon name="arrow" />
            </button>
          </div>
        </div>
      </section>
      <div className="embed-proof">
        <span>STOREFRONT: NULL OBJECTS</span>
        <span>CHECKOUT: NUMA EMBED / INLINE OR MODAL</span>
        <span>ATTRIBUTION: RIO-08-X</span>
      </div>
      {widget && (
        <div
          className="widget-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setWidget(false);
          }}
        >
          <button className="widget-close" onClick={() => setWidget(false)}>
            <Icon name="close" />
          </button>
          <div className="widget-shell">
            <div className="widget-top">
              <Logo />
              <span>TESTNET / 1874</span>
            </div>
            <Checkout />
          </div>
        </div>
      )}
    </main>
  );
}

function SystemStates() {
  const [selected, setSelected] = useState(0);
  const error = relayerErrors[selected];
  return (
    <main className="page system-page">
      <section className="system-head">
        <span>COMPONENTS / FAILURE PATHS</span>
        <h1>
          WHEN THINGS
          <br />
          <em>DON’T SETTLE.</em>
        </h1>
        <p>
          Calm copy, specific next steps, and no blind retry button. Failure is part of the product,
          not a modal someone forgot.
        </p>
      </section>
      <section className="error-lab">
        <aside>
          {relayerErrors.map((x, i) => (
            <button
              className={selected === i ? "active" : ""}
              onClick={() => setSelected(i)}
              key={x[0]}
            >
              {x[0]}
            </button>
          ))}
        </aside>
        <div className="error-stage">
          <div className="failed-receipt">
            <span>NUMA / PAYMENT</span>
            <Stamp>FAILED</Stamp>
            <h2>{error[1]}</h2>
            <p>{error[2]}</p>
            <code>{error[0]}</code>
            {error[0] === "TX_TIMEOUT" && (
              <button>
                VIEW ON EXPLORER <Icon name="external" />
              </button>
            )}
            <small>TESTNET · no settled transaction confirmed</small>
          </div>
        </div>
      </section>
      <section className="component-strip">
        <h2>the states we ship.</h2>
        <div>
          <button className="hard-button">PRIMARY</button>
          <button className="outline-button">SECONDARY</button>
          <button className="danger-button">DESTRUCTIVE</button>
          <button disabled>DISABLED</button>
        </div>
        <div className="badge-showcase">
          <VerificationBadge state="verified" />
          <VerificationBadge state="unverified" />
          <VerificationBadge state="unchecked" />
          <span className="status live">SETTLED</span>
          <span className="status held">HELD</span>
          <span className="status refunded">REFUNDED</span>
        </div>
        <div className="toast-showcase">
          <div>
            <i className="spinner" />
            transaction pending <small>Whitechain · 0xa91…20c</small>
          </div>
          <div className="toast-success">
            <Icon name="check" />
            transaction confirmed <small>block 18,491,202</small>
          </div>
          <div className="toast-error">
            ! signature rejected <small>nothing was submitted</small>
          </div>
        </div>
      </section>
    </main>
  );
}

function Verify() {
  const [input, setInput] = useState("");
  const [checked, setChecked] = useState(false);
  return (
    <main className="page verify-page">
      <section className="verify-intro">
        <span>JUDGE TOOL / NO TRUST REQUIRED</span>
        <h1>
          DON’T TAKE
          <br />
          OUR WORD <em>FOR IT.</em>
        </h1>
        <p>
          Paste a Whitechain transaction hash or numa order ID. We’ll show exactly what agrees—and
          what doesn’t.
        </p>
      </section>
      <section className="verify-box">
        <label>TRANSACTION HASH OR ORDER ID</label>
        <div>
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setChecked(false);
            }}
            placeholder="0xa91f…20c8 or NMA-8821"
          />
          <button disabled={!input} onClick={() => setChecked(true)}>
            VERIFY <Icon name="arrow" />
          </button>
        </div>
        <p>
          money state comes from Whitechain. Arkiv indexing can lag behind. We label that instead of
          guessing.
        </p>
      </section>
      {checked && (
        <section className="verify-result">
          <div className="result-title">
            <div>
              <Icon name="check" size={30} />
              <span>ORDERSETTLED MATCH</span>
            </div>
            <Stamp tone="green">VERIFIED</Stamp>
          </div>
          <div className="verify-grid">
            <div>
              <small>ORDER</small>
              <b>NMA-8821</b>
              <span>chain-confirmed</span>
            </div>
            <div>
              <small>GROSS</small>
              <b>125.00 USDT</b>
              <span>block 18,491,202</span>
            </div>
            <div>
              <small>MERCHANT</small>
              <code>0x4be…8a01</code>
              <span>101.25 USDT paid</span>
            </div>
            <div>
              <small>CREATOR</small>
              <code>0x71c…d03a</code>
              <span>22.50 USDT held</span>
            </div>
          </div>
          <div className="agreement">
            <p>
              <Icon name="check" /> Whitechain event and order fields agree
            </p>
            <p>
              <Icon name="check" /> Creator attribution entity owner matches
            </p>
            <p className="sync">
              <i /> Arkiv decision entity syncing
            </p>
          </div>
          <details>
            <summary>show me the receipts</summary>
            <pre>
              event OrderSettled(bytes32 indexed orderId,{"\n"} address merchant, address creator,
              {"\n"} uint256 gross, uint256 commission)
            </pre>
          </details>
        </section>
      )}
    </main>
  );
}

function Footer({ setView }: { setView: (v: View) => void }) {
  return (
    <footer>
      <div className="footer-top">
        <div>
          <Logo />
          <p>real money is the metric.</p>
        </div>
        <div className="footer-links">
          <button onClick={() => setView("campaigns")}>campaigns</button>
          <button onClick={() => setView("leaderboard")}>leaderboard</button>
          <button onClick={() => setView("verify")}>verify</button>
          <button onClick={() => setView("demo")}>demo shop</button>
          <button onClick={() => setView("creatorApp")}>creator app</button>
          <button onClick={() => setView("merchant")}>merchant app</button>
          <button onClick={() => setView("system")}>system states</button>
        </div>
        <Stamp>TESTNET ONLY</Stamp>
      </div>
      <div className="footer-bottom">
        <span>© 2026 NUMA PROTOCOL</span>
        <span>WHITECHAIN SEPOLIA / CHAIN 1874</span>
        <span>NO COOKIES. NO CLICK TRACKING.</span>
      </div>
      <div className="footer-word" data-scrub="in" aria-hidden="true">
        numa
      </div>
    </footer>
  );
}

export default function App() {
  const [view, setViewState] = useState<View>("home");
  const [intro, setIntro] = useState<"on" | "out" | "done">(reducedMotion() ? "done" : "on");
  const [wipe, setWipe] = useState<"idle" | "in" | "out">("idle");
  const viewRef = useRef<View>("home");
  const ready = intro !== "on";

  // Intro: wordmark draws in (~1.4s), curtain lifts, then the hero choreography starts.
  useEffect(() => {
    if (intro !== "on") return;
    const t1 = window.setTimeout(() => setIntro("out"), 1500);
    const t2 = window.setTimeout(() => setIntro("done"), 2250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [intro]);

  // Page transition: black wipe up from the bottom, swap the view under it, wipe away.
  const setView = (v: View) => {
    if (v === viewRef.current) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const swap = () => {
      viewRef.current = v;
      setViewState(v);
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    if (reducedMotion()) {
      swap();
      return;
    }
    setWipe("in");
    window.setTimeout(() => {
      swap();
      setWipe("out");
      window.setTimeout(() => setWipe("idle"), 560);
    }, 520);
  };
  const setViewRef = useRef(setView);
  setViewRef.current = setView;
  useEffect(() => {
    const handler = (e: Event) => setViewRef.current((e as CustomEvent<View>).detail);
    window.addEventListener("nav", handler);
    return () => window.removeEventListener("nav", handler);
  }, []);

  useScrollMotion(view, intro !== "on");

  return (
    <div className={`app ${ready ? "is-ready" : ""}`}>
      {intro !== "done" && <Loader out={intro === "out"} />}
      <div className={`page-wipe ${wipe === "idle" ? "" : wipe}`} aria-hidden="true">
        numa
      </div>
      <Cursor />
      <Header view={view} setView={setView} />
      {view === "home" && <Home setView={setView} ready={ready} />}
      {view === "how" && <HowItWorks />}
      {view === "campaigns" && <Campaigns />}
      {view === "creator" && <Creator />}
      {view === "leaderboard" && <Leaderboard />}
      {view === "creatorApp" && <CreatorApp />}
      {view === "merchant" && <MerchantApp />}
      {view === "checkout" && <Checkout />}
      {view === "demo" && <DemoShop />}
      {view === "verify" && <Verify />}
      {view === "system" && <SystemStates />}
      {view !== "checkout" && view !== "demo" && <Footer setView={setView} />}
    </div>
  );
}
