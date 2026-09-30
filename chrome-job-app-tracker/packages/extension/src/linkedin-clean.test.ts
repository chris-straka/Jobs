import { describe, expect, it } from "bun:test";
import {
  DEFAULT_LINKEDIN_CLEAN,
  allGroupsOff,
  groupForHeading,
  groupForNav,
  isFeedPath,
  isJobsPath,
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

  it("maps the premium upsell CTA and views pitch", () => {
    expect(groupForHeading("Try Premium")).toBe("premiumUpsell");
    expect(groupForHeading("Try Premium for CA$0")).toBe("premiumUpsell");
    expect(groupForHeading("Get 4x more recruiter views on average with AI tools")).toBe(
      "premiumUpsell",
    );
    expect(groupForHeading("get 2× more profile views")).toBe("premiumUpsell");
  });

  it("maps news and exact Promoted labels", () => {
    expect(groupForHeading("LinkedIn News")).toBe("linkedinNews");
    expect(groupForHeading("Promoted")).toBe("promotedAds");
    expect(groupForHeading("Promoted •••")).toBe("promotedAds");
    expect(groupForHeading("Promoted to Staff Engineer")).toBeNull();
  });

  it("survives a trailing Show all control in the same heading", () => {
    expect(groupForHeading("People also viewed Show all")).toBe("peopleAlsoViewed");
    expect(groupForHeading("people you may know  show all")).toBe("peopleYouMayKnow");
  });

  it("leaves real content alone", () => {
    for (const heading of [
      "",
      "Experience",
      "People",
      "About",
      "Add a skill",
      "Feed",
      "Premium",
      "Get more views on your posts",
      "Today's puzzles",
      "Home",
      "My Network",
    ]) {
      expect(groupForHeading(heading)).toBeNull();
    }
  });
});

describe("groupForNav", () => {
  it("matches nav labels exactly", () => {
    expect(groupForNav("Home")).toBe("navHome");
    expect(groupForNav("My Network")).toBe("navNetwork");
    expect(groupForNav("For Business")).toBe("navBusiness");
  });

  it("rejects near-misses", () => {
    for (const label of ["", "Homes", "Home2", "My Networks", "For Businesses", "Jobs", "News"]) {
      expect(groupForNav(label)).toBeNull();
    }
  });
});

describe("isFeedPath", () => {
  it("matches the home feed, not permalinks or sections", () => {
    for (const p of ["/", "/feed", "/feed/", "/home", "/home/"]) {
      expect(isFeedPath(p)).toBe(true);
    }
    for (const p of ["/in/ada", "/jobs/search", "/feed/update/urn:li:1", "/messaging"]) {
      expect(isFeedPath(p)).toBe(false);
    }
  });
});

describe("isJobsPath", () => {
  it("matches jobs search and detail paths", () => {
    for (const p of ["/jobs", "/jobs/", "/jobs/search/", "/jobs/view/123"]) {
      expect(isJobsPath(p)).toBe(true);
    }
    for (const p of ["/", "/feed/", "/in/ada", "/jobs2"]) {
      expect(isJobsPath(p)).toBe(false);
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
        loadingSkeletons: false,
        homeFeed: false,
        extra: true,
      }),
    ).toEqual({
      peopleAlsoViewed: false,
      peopleYouMayKnow: true,
      youMightLike: true,
      followSuggestions: true,
      premiumUpsell: true,
      loadingSkeletons: false,
      navHome: true,
      navNetwork: true,
      navBusiness: true,
      linkedinNews: true,
      promotedAds: true,
      homeFeed: false,
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
        premiumUpsell: false,
        loadingSkeletons: false,
        navHome: false,
        navNetwork: false,
        navBusiness: false,
        linkedinNews: false,
        promotedAds: false,
        homeFeed: false,
      }),
    ).toBe(true);
  });
});
