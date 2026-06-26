import { signOutAction } from "../(app)/actions";

export default function OrgDisabledPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-8 text-center space-y-4">
        <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto text-amber-600 text-xl">⚠</div>
        <h1 className="text-xl font-bold text-slate-900">Access suspended</h1>
        <p className="text-sm text-slate-500">
          Your organization&rsquo;s access has been suspended. Please contact Coverlog to restore it.
        </p>
        <form action={signOutAction}>
          <button className="border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
