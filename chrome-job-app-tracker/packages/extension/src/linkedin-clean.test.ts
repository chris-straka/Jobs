import { describe, expect, it } from "bun:test";
import {
  DEFAULT_LINKEDIN_CLEAN,
  allGroupsOff,
  groupForHeading,
  isLinkedInHost,
  normalizeHeading,
  parseLinkedInCleanSettings,
} from "./linkedin-clean.js";

describe("isLinkedInHost", () => {
  it("matches linkedin.com and its subdomains", () => {
    for (const host of ["linkedin.com", "www.linkedin.com", "foo.linkedin.com"]) {
      expect(isLinkedInHost(host)).toBe(true);
    }
  });

  it("rejects lookalikes and other hosts", () => {
    for (const host of [
      "",
      "evil.com",
      "linkedin.com.evil.com",
      "notlinkedin.com",
      "linkedin.co",
      "fakelinkedin.com",
    ]) {
      expect(isLinkedInHost(host)).toBe(false);
    }
  });

  it("tolerates case, whitespace, and a trailing dot", () => {
    expect(isLinkedInHost("  WWW.LinkedIn.COM. ")).toBe(true);
  });
});

describe("normalizeHeading", () => {
  it("collapses inner whitespace", () => {
    expect(normalizeHeading("  People\n  also\t viewed ")).toBe("People also viewed");
  });
});

describe("groupForHeading", () => {
  it("maps each discovery heading to its group", () => {
    expect(groupForHeading("People also viewed")).toBe("peopleAlsoViewed");
    expect(groupForHeading("Who your viewers also viewed")).toBe("peopleAlsoViewed");
    expect(groupForHeading("More profiles for you")).toBe("peopleAlsoViewed");
    expect(groupForHeading("People you may know")).toBe("peopleYouMayKnow");
    expect(groupForHeading("You might like")).toBe("youMightLike");
    expect(groupForHeading("Add to your feed")).toBe("followSuggestions");
  });

  it("survives a trailing Show all control in the same heading", () => {
    expect(groupForHeading("People also viewed Show all")).toBe("peopleAlsoViewed");
    expect(groupForHeading("people you may know  show all")).toBe("peopleYouMayKnow");
  });

  it("leaves real content alone", () => {
    for (const heading of ["", "Experience", "People", "About", "Add a skill", "Feed"]) {
      expect(groupForHeading(heading)).toBeNull();
    }
  });
});

describe("parseLinkedInCleanSettings", () => {
  it("defaults to hiding everything", () => {
    expect(parseLinkedInCleanSettings(undefined)).toEqual(DEFAULT_LINKEDIN_CLEAN);
    expect(parseLinkedInCleanSettings(null)).toEqual(DEFAULT_LINKEDIN_CLEAN);
    expect(parseLinkedInCleanSettings({})).toEqual(DEFAULT_LINKEDIN_CLEAN);
    expect(parseLinkedInCleanSettings("nope")).toEqual(DEFAULT_LINKEDIN_CLEAN);
    expect(Object.values(DEFAULT_LINKEDIN_CLEAN).every(Boolean)).toBe(true);
  });

  it("keeps explicit offs and drops garbage", () => {
    expect(
      parseLinkedInCleanSettings({
        peopleAlsoViewed: false,
        peopleYouMayKnow: "yes",
        extra: true,
      }),
    ).toEqual({
      peopleAlsoViewed: false,
      peopleYouMayKnow: true,
      youMightLike: true,
      followSuggestions: true,
    });
  });
});

describe("allGroupsOff", () => {
  it("reports only when every group is off", () => {
    expect(allGroupsOff(DEFAULT_LINKEDIN_CLEAN)).toBe(false);
    expect(
      allGroupsOff({
        peopleAlsoViewed: false,
        peopleYouMayKnow: false,
        youMightLike: false,
        followSuggestions: false,
      }),
    ).toBe(true);
  });
});
