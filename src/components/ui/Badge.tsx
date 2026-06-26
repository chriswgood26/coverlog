const COLORS: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-700",
  enrolled: "bg-emerald-100 text-emerald-700",
  active: "bg-emerald-100 text-emerald-700",
  in_network: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  out_of_network: "bg-amber-100 text-amber-700",
  expiring: "bg-amber-100 text-amber-700",
  expired: "bg-amber-100 text-amber-700",
  inactive: "bg-slate-100 text-slate-500",
  terminated: "bg-slate-100 text-slate-500",
  not_enrolled: "bg-slate-100 text-slate-500",
  revoked: "bg-slate-100 text-slate-500",
  flagged: "bg-red-100 text-red-600",
  denied: "bg-red-100 text-red-600",
  admin: "bg-purple-100 text-purple-700",
  specialist: "bg-slate-100 text-slate-600",
};

export function statusColor(v: string): string {
  return COLORS[v] ?? "bg-slate-100 text-slate-600";
}

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${statusColor(value)}`}>
      {(label ?? value).replace(/_/g, " ")}
    </span>
  );
}
