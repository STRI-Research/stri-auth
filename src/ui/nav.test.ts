import { describe, expect, it } from "vitest";
import { initials, isActive, projectNav, type Destination } from "./nav";

const d = (over: Partial<Destination> & Pick<Destination, "href">): Destination => ({
  label: "X",
  description: "x",
  icon: "list",
  ...over,
});

describe("projectNav", () => {
  it("projects each surface from the one list", () => {
    const list = [
      d({ href: "/", primary: true, bar: true }),
      d({ href: "/faults", primary: true, bar: true, badge: true }),
      d({ href: "/checks", primary: true }),
    ];
    const nav = projectNav(list);

    expect(nav.header.map((x) => x.href)).toEqual(["/", "/faults", "/checks"]);
    expect(nav.bar.map((x) => x.href)).toEqual(["/", "/faults"]);
    expect(nav.more.map((x) => x.href)).toEqual(["/checks"]);
  });

  it("routes everything the bar cannot reach through /more", () => {
    const nav = projectNav([d({ href: "/checks", primary: true })]);
    expect(nav.moreRoutes).toContain("/checks");
    expect(nav.moreRoutes).toContain("/more");
  });

  // The /tags bug: reachable on a phone via More, invisible on a desktop
  // because it claimed neither surface. Apps assert this list is empty.
  it("reports a destination that would be invisible on desktop", () => {
    const nav = projectNav([d({ href: "/tags" })]);
    expect(nav.unreachable.map((x) => x.href)).toEqual(["/tags"]);
  });

  it("accepts one reached from somewhere specific", () => {
    const nav = projectNav([
      d({ href: "/machines/new", linkedFrom: "the button on the machines list" }),
    ]);
    expect(nav.unreachable).toEqual([]);
  });
});

describe("isActive", () => {
  it("keeps the list lit on a detail page", () => {
    expect(isActive("/machines/42", "/machines")).toBe(true);
  });

  it("does not let the root win every path", () => {
    expect(isActive("/machines", "/")).toBe(false);
    expect(isActive("/", "/")).toBe(true);
  });

  it("does not match a sibling that shares a prefix", () => {
    expect(isActive("/machines", "/machine")).toBe(false);
  });
});

describe("initials", () => {
  it("takes first and last", () => {
    expect(initials("Sam Avison")).toBe("SA");
    expect(initials("Glenn  Kirby")).toBe("GK");
    expect(initials("Ada Lovelace King")).toBe("AK");
  });

  it("copes with one name", () => {
    expect(initials("Sam")).toBe("S");
  });

  // A missing name must still render a circle — collapsing the avatar moves the
  // whole header layout.
  it("falls back rather than rendering nothing", () => {
    expect(initials(null)).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});
