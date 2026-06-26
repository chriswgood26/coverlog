import { describe, it, expect, afterEach } from "vitest";
import { cronAuthorized } from "@/lib/cron/auth";

const orig = process.env.CRON_SECRET;
afterEach(() => {
  if (orig === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = orig;
});

function req(auth?: string) {
  return new Request("https://x/api/cron/weekly-digest",
    auth ? { headers: { authorization: auth } } : undefined);
}

describe("cronAuthorized", () => {
  it("accepts the correct Bearer token", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(cronAuthorized(req("Bearer s3cret"))).toBe(true);
  });
  it("rejects a wrong or missing token", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(cronAuthorized(req("Bearer nope"))).toBe(false);
    expect(cronAuthorized(req())).toBe(false);
  });
  it("rejects everything when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(cronAuthorized(req("Bearer s3cret"))).toBe(false);
  });
});
