import Link from "next/link";

export function PageHeader({ title, subtitle, backHref, children }: {
  title: string; subtitle?: string; backHref?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {backHref && <Link href={backHref} aria-label="Back" className="text-slate-400 hover:text-slate-700">←</Link>}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="text-slate-500 text-sm mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
