function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type AlertCounts = {
  licensesExpiring: number;
  revalidationsDue: number;
  consentsExpiring: number;
  dueThisWeek: number;
  needsAttention: number;
};

export function shouldSendDigest(counts: AlertCounts): boolean {
  return Object.values(counts).some((n) => n > 0);
}

const LABELS: Array<[keyof AlertCounts, string]> = [
  ["licensesExpiring", "Provider licenses expiring (≤60 days)"],
  ["revalidationsDue", "Payer enrollment revalidations due (≤60 days)"],
  ["consentsExpiring", "Patient consents expiring (≤60 days)"],
  ["dueThisWeek", "Eligibility re-checks due this week"],
  ["needsAttention", "Patients needing attention"],
];

export function buildOrgDigest(
  orgName: string, counts: AlertCounts, appUrl: string,
): { subject: string; html: string; text: string } {
  const lines = LABELS.map(([k, label]) => `${label}: ${counts[k]}`);
  const subject = `Coverlog weekly summary — ${orgName}`;
  const text = [
    `Weekly summary for ${orgName}`,
    "",
    ...lines,
    "",
    `Open Coverlog: ${appUrl}`,
  ].join("\n");
  const html = [
    `<h2>Weekly summary for ${escapeHtml(orgName)}</h2>`,
    "<ul>",
    ...LABELS.map(([k, label]) => `<li>${label}: <strong>${counts[k]}</strong></li>`),
    "</ul>",
    `<p><a href="${appUrl}">Open Coverlog</a></p>`,
  ].join("");
  return { subject, html, text };
}
