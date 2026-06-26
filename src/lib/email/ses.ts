import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export type SendEmailArgs = { to: string[]; subject: string; html: string; text: string };

// Sends via AWS SES. Gracefully no-ops (no throw) when SES_FROM_ADDRESS or AWS
// credentials are absent, so non-prod/test environments don't fail. Throws on a
// real SES API error.
export async function sendEmail(
  args: SendEmailArgs,
): Promise<{ sent: boolean; skipped?: boolean }> {
  const from = process.env.SES_FROM_ADDRESS;
  if (!from || !process.env.AWS_ACCESS_KEY_ID) return { sent: false, skipped: true };
  const client = new SESv2Client({ region: process.env.AWS_REGION });
  await client.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: args.to },
    Content: { Simple: {
      Subject: { Data: args.subject },
      Body: { Html: { Data: args.html }, Text: { Data: args.text } },
    } },
  }));
  return { sent: true };
}
