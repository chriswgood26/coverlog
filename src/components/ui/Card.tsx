export function Card({ title, headerRight, children, className }: {
  title?: string; headerRight?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className ?? ""}`}>
      {(title || headerRight) && (
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          {title && <h2 className="font-semibold text-slate-900">{title}</h2>}
          {headerRight}
        </div>
      )}
      {children}
    </div>
  );
}
