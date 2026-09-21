/**
 * Where you can go in an app, declared once.
 *
 * Generalised from Machine Tracker's `src/lib/nav.tsx`, which is the reference
 * implementation and had already learned the lesson the hard way: the
 * destinations were written out three times — desktop header, phone bottom bar,
 * and again on the More page — and had drifted. One entry existed only on More;
 * the dashboard was called "Dashboard" in one surface and nothing in another.
 * Every surface now projects one list.
 *
 *   primary — earns a slot in the desktop header
 *   bar     — earns a slot in the phone bottom bar (a subset of primary)
 *   badge   — carries a count the app supplies at render time
 *
 * Anything not in `bar` falls through to More, so a destination can never be
 * added and end up unreachable on a phone. Desktop has no such safety net, and
 * that is the trap: More is hidden from 640px up, so a destination with neither
 * `primary` nor `bar` is reachable on a phone and invisible on a desktop.
 * Machine Tracker shipped `/tags` that way and it could only be found by typing
 * the URL.
 *
 * `projectNav` therefore returns `unreachable` alongside the projections, and
 * apps assert on it in a test rather than relying on a comment being read.
 */

export type NavIconName =
  | "home"
  | "list"
  | "alert"
  | "check"
  | "chart"
  | "calendar"
  | "cloud"
  | "doc"
  | "people"
  | "settings"
  | "tag"
  | "add"
  | "search"
  | "more";

export interface Destination {
  /** Path this destination lives at. */
  href: string;
  /** What it is called. One word or two — it has to survive a phone bar. */
  label: string;
  /** One line, shown on the More page under the label. */
  description: string;
  icon: NavIconName;
  /** Earns a slot in the desktop header. */
  primary?: boolean;
  /** Earns a slot in the phone bottom bar. Should also be `primary`. */
  bar?: boolean;
  /** Carries a count, which the app passes to the nav at render time. */
  badge?: boolean;
  /**
   * Reached from somewhere specific instead of a row of destinations — a button
   * on a list, or the account menu. Exempts it from the reachability check, and
   * saying where is the point: an exemption with no reason is how `/tags`
   * happened.
   */
  linkedFrom?: string;
}

export interface NavProjection {
  /** The desktop header, left to right. */
  header: Destination[];
  /** The phone bottom bar. */
  bar: Destination[];
  /** Whatever the bottom bar cannot reach, listed on More. */
  more: Destination[];
  /** Routes that should light up "More" in the bottom bar. */
  moreRoutes: string[];
  /**
   * Destinations reachable on a phone but invisible on a desktop, and not
   * explained by `linkedFrom`. Assert this is empty in a test.
   */
  unreachable: Destination[];
}

export function projectNav(destinations: Destination[]): NavProjection {
  const header = destinations.filter((d) => d.primary);
  const bar = destinations.filter((d) => d.bar);
  const more = destinations.filter((d) => !d.bar);

  return {
    header,
    bar,
    more,
    moreRoutes: [...more.map((d) => d.href), "/more"],
    unreachable: destinations.filter(
      (d) => !d.primary && !d.bar && !d.linkedFrom
    ),
  };
}

/**
 * Does `href` own the current page?
 *
 * Matches on the first path segment, so a detail page still lights up the list
 * it came from — `/machines/42` keeps "Machines" active. `/` is special-cased
 * because every path starts with it and it would otherwise always win.
 */
export function isActive(pathname: string, href: string): boolean {
  const seg = (p: string) => "/" + (p.split("/")[1] ?? "");
  if (href === "/") return pathname === "/";
  return seg(pathname) === seg(href);
}

/**
 * Initials for the account menu's avatar, from whatever the Suite gave us.
 *
 * Two letters where there are two words, one otherwise. Falls back to "?" so a
 * missing name renders a circle rather than collapsing the header layout.
 */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts.at(-1)!.slice(0, 1)).toUpperCase();
}
