import { describe, it, expect, afterEach } from "vitest";
import { sendEmail } from "@/lib/email/ses";

const origFrom = process.env.SES_FROM_ADDRESS;
afterEach(() => {
  if (origFrom === undefined) delete process.env.SES_FROM_ADDRESS;
  else process.env.SES_FROM_ADDRESS = origFrom;
});

const origKey = process.env.AWS_ACCESS_KEY_ID;
afterEach(() => {
  if (origKey === undefined) delete process.env.AWS_ACCESS_KEY_ID;
  else process.env.AWS_ACCESS_KEY_ID = origKey;
});

describe("sendEmail graceful no-op", () => {
  it("skips (does not throw) when SES_FROM_ADDRESS is unset", async () => {
    delete process.env.SES_FROM_ADDRESS;
    const res = await sendEmail({ to: ["a@b.com"], subject: "s", html: "<p>h</p>", text: "h" });
    expect(res).toEqual({ sent: false, skipped: true });
  });
  it("skips when AWS_ACCESS_KEY_ID is unset even if SES_FROM_ADDRESS is set", async () => {
    process.env.SES_FROM_ADDRESS = "from@example.com";
    delete process.env.AWS_ACCESS_KEY_ID;
    const res = await sendEmail({ to: ["a@b.com"], subject: "s", html: "<p>h</p>", text: "h" });
    expect(res).toEqual({ sent: false, skipped: true });
  });
});
