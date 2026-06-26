import Link from "next/link";
import { signInAction } from "./actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form action={signInAction} className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-white font-bold text-xs">C</div>
          <span className="font-bold text-slate-900">Coverlog</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900">Sign in</h1>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input name="email" type="email" required placeholder="Email" className={inputClass} />
        <input name="password" type="password" required placeholder="Password" className={inputClass} />
        <button type="submit" className={`${btnPrimary} w-full`}>Sign in</button>
        <p className="text-sm text-slate-500">No account? <Link href="/sign-up" className="text-teal-600 hover:text-teal-700 font-medium">Sign up</Link></p>
      </form>
    </div>
  );
}
