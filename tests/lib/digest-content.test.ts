import { describe, it, expect } from "vitest";
import { shouldSendDigest, buildOrgDigest, type AlertCounts } from "@/lib/email/digest";

const ZERO: AlertCounts = { licensesExpiring: 0, revalidationsDue: 0, consentsExpiring: 0, dueThisWeek: 0, needsAttention: 0 };

describe("shouldSendDigest", () => {
  it("is false when all counts are zero", () => {
    expect(shouldSendDigest(ZERO)).toBe(false);
  });
  it("is true when any count is positive", () => {
    expect(shouldSendDigest({ ...ZERO, consentsExpiring: 2 })).toBe(true);
  });
});

describe("buildOrgDigest", () => {
  const counts: AlertCounts = { licensesExpiring: 3, revalidationsDue: 1, consentsExpiring: 2, dueThisWeek: 4, needsAttention: 5 };
  const out = buildOrgDigest("Maple Clinic", counts, "https://app.example/dashboard");

  it("puts the org name in the subject", () => {
    expect(out.subject).toContain("Maple Clinic");
  });
  it("includes every count and the login link in the text body", () => {
    for (const n of ["3", "1", "2", "4", "5"]) expect(out.text).toContain(n);
    expect(out.text).toContain("https://app.example/dashboard");
    expect(out.html).toContain("https://app.example/dashboard");
  });
  it("is PHI-minimized: body mentions only counts/labels/link, no patient fields", () => {
    // Built solely from orgName + integer counts + url, so no PHI tokens can appear.
    expect(out.text.toLowerCase()).not.toMatch(/member id|date of birth|\bdob\b|ssn/);
  });
  it("HTML-escapes the org name in the html body", () => {
    const o = buildOrgDigest("Smith & Co <Clinic>", { licensesExpiring: 1, revalidationsDue: 0, consentsExpiring: 0, dueThisWeek: 0, needsAttention: 0 }, "https://app.example");
    expect(o.html).toContain("Smith &amp; Co &lt;Clinic&gt;");
    expect(o.html).not.toContain("Smith & Co <Clinic>");
  });
});
