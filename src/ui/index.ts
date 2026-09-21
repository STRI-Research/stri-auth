/**
 * STRIUX — the shared interface every STRI app wears.
 *
 *   import { AppShell, AccountMenu, type Destination } from "@stri/auth/ui";
 *
 * and, once, in the app's stylesheet:
 *
 *   @import "@stri/auth/ui/tokens.css";
 *   @import "@stri/auth/ui/ui.css";
 *   @import "@stri/auth/ui/tailwind.css";   — Tailwind apps only
 *
 * The rule this package exists to serve is D1: the design system is consumed,
 * never forked. Shared material here, per-app character through the five
 * `--stri-accent-*` / `--stri-header` variables an app overrides in its own
 * theme layer. Apps should not look identical — they should look related.
 *
 * Components take their pathname as a prop rather than calling a router hook,
 * which is what lets the same set serve App Router and Weather's Pages Router.
 * See the note in `shell.tsx`.
 */

export {
  projectNav,
  isActive,
  initials,
  type Destination,
  type NavIconName,
  type NavProjection,
} from "./nav";

export { NavIcon } from "./icons";

export {
  AppShell,
  AppHeader,
  Nav,
  BottomNav,
  MoreList,
  type AppShellProps,
  type AppHeaderProps,
  type ShellNavProps,
} from "./shell";

export { AccountMenu, type AccountMenuProps } from "./account-menu";
