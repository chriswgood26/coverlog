import { describe, it, expect, afterEach } from "vitest";

const orig = process.env.CRON_SECRET;
afterEach(() => {
  if (orig === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = orig;
});

describe("cron routes", () => {
  it("weekly-digest GET returns 401 without the cron secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { GET } = await import("@/app/api/cron/weekly-digest/route");
    const res = await GET(new Request("https://x/api/cron/weekly-digest"));
    expect(res.status).toBe(401);
  });
  it("ensure-partitions GET returns 401 without the cron secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { GET } = await import("@/app/api/cron/ensure-partitions/route");
    const res = await GET(new Request("https://x/api/cron/ensure-partitions"));
    expect(res.status).toBe(401);
  });
});
