"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "../actions";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/patients", label: "Patients" },
  { href: "/payers", label: "Payers" },
  { href: "/providers", label: "Providers" },
];

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;
  const itemClass = (href: string) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
      active ? "bg-[#0d1b2e] text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;
  };
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col h-[calc(100vh-3px)] sticky top-[3px]">
      <div className="px-5 pt-4 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-white font-bold text-xs">C</div>
          <span className="font-bold text-slate-900">Coverlog</span>
        </div>
      </div>
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className={itemClass(it.href)}>{it.label}</Link>
        ))}
      </nav>
      <div className="px-3 py-3 border-t border-slate-200">
        <form action={signOutAction}>
          <button className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
