"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { isActive, projectNav, type Destination } from "./nav";
import { NavIcon } from "./icons";

/**
 * The shell: a dark header with the app's name and its destinations, the page
 * beneath it, and on a phone a bottom bar instead of the header nav.
 *
 * ── Why `pathname` is a prop ───────────────────────────────────────────────
 * The obvious thing is to call `usePathname()` in here. It would work in four
 * of the five apps and throw in the fifth: Weather's screens are Pages Router,
 * where the `next/navigation` hooks are not available, and it reads its path
 * from `next/router` instead. Taking the path as a prop keeps one component set
 * serving both routers, and keeps these components presentational — they can be
 * rendered in a test without a router at all.
 *
 * `next/link` is used directly because it is the one part that works unchanged
 * in both routers and in every Next major the estate runs (14 through 16).
 *
 * ── Counts ────────────────────────────────────────────────────────────────
 * A destination marked `badge` gets its number from `counts`, keyed on href.
 * They are passed in rather than fetched because the number is always a query
 * this app's database can answer and this package cannot.
 */

export interface ShellNavProps {
  destinations: Destination[];
  pathname: string;
  counts?: Record<string, number>;
}

/** The desktop header nav. Hidden below 640px, where the bottom bar takes over. */
export function Nav({ destinations, pathname, counts }: ShellNavProps) {
  const { header } = projectNav(destinations);

  return (
    <nav className="stri-nav" aria-label="Main">
      {header.map((d) => {
        const active = isActive(pathname, d.href);
        const count = d.badge ? (counts?.[d.href] ?? 0) : 0;
        return (
          <Link
            key={d.href}
            href={d.href}
            className={`stri-nav-link${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {d.label}
            {count > 0 && (
              <span className="stri-badge">
                {count}
                <span className="stri-sr-only"> outstanding</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The phone bottom bar. Anything it cannot fit falls through to `/more`, which
 * is why `projectNav` guarantees `more` is reachable — a destination can never
 * be added and end up with no way to it on a phone.
 */
export function BottomNav({ destinations, pathname, counts }: ShellNavProps) {
  const { bar, more, moreRoutes } = projectNav(destinations);
  const moreActive = moreRoutes.some((r) => isActive(pathname, r));

  return (
    <nav className="stri-bar" aria-label="Main">
      {bar.map((d) => {
        const active = isActive(pathname, d.href);
        const count = d.badge ? (counts?.[d.href] ?? 0) : 0;
        return (
          <Link
            key={d.href}
            href={d.href}
            className={`stri-bar-link${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span style={{ position: "relative", display: "inline-flex" }}>
              <NavIcon name={d.icon} />
              {count > 0 && (
                <span
                  className="stri-badge"
                  style={{ position: "absolute", top: -4, insetInlineStart: 12 }}
                >
                  {count}
                </span>
              )}
            </span>
            <span className="stri-bar-label">{d.label}</span>
          </Link>
        );
      })}
      {more.length > 0 && (
        <Link
          href="/more"
          className={`stri-bar-link${moreActive ? " is-active" : ""}`}
          aria-current={moreActive ? "page" : undefined}
        >
          <NavIcon name="more" />
          <span className="stri-bar-label">More</span>
        </Link>
      )}
    </nav>
  );
}

export interface AppHeaderProps extends ShellNavProps {
  /** The app's name, as it should read. Authored lower case where the house
   *  signature calls for it — never `text-transform`. */
  brand: ReactNode;
  /** Where the brand links to. Defaults to the app root. */
  brandHref?: string;
  /** The account menu, or anything else that belongs top-right. */
  end?: ReactNode;
}

export function AppHeader({
  brand,
  brandHref = "/",
  end,
  destinations,
  pathname,
  counts,
}: AppHeaderProps) {
  return (
    <header className="stri-header">
      <div className="stri-header-inner">
        <Link href={brandHref} className="stri-header-brand">
          {brand}
        </Link>
        <div className="stri-header-nav">
          <Nav
            destinations={destinations}
            pathname={pathname}
            counts={counts}
          />
        </div>
        {end && <div className="stri-header-end">{end}</div>}
      </div>
    </header>
  );
}

export interface AppShellProps extends AppHeaderProps {
  children: ReactNode;
}

/**
 * The whole chrome in one component, which is what four of the five apps want.
 * An app that needs to assemble it differently — Machine Tracker raises a Scan
 * button into the middle of the bar — composes `AppHeader`, `BottomNav` and
 * `.stri-shell` itself instead.
 */
export function AppShell({ children, ...header }: AppShellProps) {
  return (
    <div className="stri-shell">
      <AppHeader {...header} />
      <main className="stri-shell-main">{children}</main>
      <BottomNav
        destinations={header.destinations}
        pathname={header.pathname}
        counts={header.counts}
      />
    </div>
  );
}

/**
 * The More page's list — every destination the bottom bar could not fit, with
 * the descriptions that only appear here. Render it at `/more`.
 */
export function MoreList({ destinations }: { destinations: Destination[] }) {
  const { more } = projectNav(destinations);

  return (
    <ul style={{ display: "grid", gap: "0.5rem", listStyle: "none", padding: 0, margin: 0 }}>
      {more.map((d) => (
        <li key={d.href}>
          <Link
            href={d.href}
            className="stri-card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <NavIcon name={d.icon} size={22} />
            <span>
              <strong style={{ display: "block", fontSize: "0.9375rem" }}>
                {d.label}
              </strong>
              <span style={{ fontSize: "0.8125rem", color: "var(--stri-muted-fg)" }}>
                {d.description}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
