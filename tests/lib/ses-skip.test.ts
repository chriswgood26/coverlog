import { describe, it, expect, afterEach } from "vitest";
import { sendEmail } from "@/lib/email/ses";

const origFrom = process.env.SES_FROM_ADDRESS;
afterEach(() => { process.env.SES_FROM_ADDRESS = origFrom; });

describe("sendEmail graceful no-op", () => {
  it("skips (does not throw) when SES_FROM_ADDRESS is unset", async () => {
    delete process.env.SES_FROM_ADDRESS;
    const res = await sendEmail({ to: ["a@b.com"], subject: "s", html: "<p>h</p>", text: "h" });
    expect(res).toEqual({ sent: false, skipped: true });
  });
});
