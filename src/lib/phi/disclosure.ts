import type { PhiContext } from "@/lib/phi/access";

export type DisclosureEntry = {
  action: string;
  patient_id?: string | null;
  purpose?: string;
  disclosed_to?: string;
  detail?: unknown;
};

// Append a 42 CFR Part 2 disclosure_log row. Throws on failure (audit must be reliable).
export async function logDisclosure(
  client: any, ctx: PhiContext, entry: DisclosureEntry,
): Promise<void> {
  const { error } = await client.from("disclosure_log").insert({
    org_id: ctx.orgId,
    actor_staff_id: ctx.staffId,
    action: entry.action,
    patient_id: entry.patient_id ?? null,
    purpose: entry.purpose ?? null,
    disclosed_to: entry.disclosed_to ?? null,
    detail: entry.detail ?? null,
  });
  if (error) throw new Error(`disclosure log write failed: ${error.message}`);
}
