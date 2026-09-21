"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { initials } from "./nav";

/**
 * The account menu, top-right on every STRI app.
 *
 * It exists as shared code because it is the one piece of chrome that is the
 * same everywhere by definition: the signed-in person comes from the Suite, and
 * so do sign-out and API access. Five apps had written it five times — Weather's
 * was plain JS with inline styles, the planner's lived in a top nav, Machine
 * Tracker's was a popover — and they disagreed about where API access lived.
 *
 * API access is in here rather than in the main nav on purpose: it is a
 * per-account concern, not a place in the app. Putting it in the nav gave every
 * user a door that only an admin could open. `canMintKeys` decides whether the
 * item renders at all, and the route behind it re-checks — this is a tidiness
 * control, never the gate.
 *
 * Deliberately uncontrolled and dependency-free: `useState` and a `useEffect`,
 * so it renders the same on React 18 (Weather) as on 19 (everything else).
 */

export interface AccountMenuProps {
  /** Display name from the Suite session. */
  name: string | null | undefined;
  /** Shown under the name. Usually the work email. */
  email?: string | null;
  /**
   * Whether this person may mint API keys for this app — the app's own admin
   * check, not a Suite role. Hides the item; the route still enforces it.
   */
  canMintKeys?: boolean;
  /** Where the API access page lives. Apps differ; Machine Tracker uses
   *  `/settings/api`, the planner `/api-access`. */
  apiAccessHref?: string;
  /** The sign-out shim. Every app mounts it at the same path. */
  signOutHref?: string;
  /** Anything app-specific to offer above sign-out — per-app preferences, say. */
  children?: ReactNode;
}

export function AccountMenu({
  name,
  email,
  canMintKeys = false,
  apiAccessHref = "/settings/api",
  signOutHref = "/api/auth/signout",
  children,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close on Escape and on a click outside. Both listeners only exist while the
  // menu is open, so a closed menu on a busy page costs nothing.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div className="stri-account" ref={root}>
      <button
        type="button"
        className="stri-account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="stri-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="stri-account-name">{name ?? "Account"}</span>
        <span className="stri-sr-only">Account menu</span>
      </button>

      {open && (
        <div className="stri-account-menu" id={menuId} role="menu">
          <div className="stri-account-head">
            <strong>{name ?? "Signed in"}</strong>
            {email && <span>{email}</span>}
          </div>

          {children}

          {canMintKeys && (
            <a className="stri-account-item" href={apiAccessHref} role="menuitem">
              API access
            </a>
          )}

          <hr className="stri-account-sep" />

          {/* A POST, not a link: signing out is a state change, and a GET here
              means any page that can embed an image can sign the user out. */}
          <form method="post" action={signOutHref}>
            <button type="submit" className="stri-account-item" role="menuitem">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
