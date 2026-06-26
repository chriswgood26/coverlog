// Vercel injects `Authorization: Bearer ${CRON_SECRET}` on cron invocations when
// CRON_SECRET is configured. Reject everything if it is unset (fail closed).
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
