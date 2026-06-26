import { submitOnboarding } from "./actions";
import { inputClass, labelClass, btnPrimary } from "@/lib/ui";

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form action={submitOnboarding} className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-md space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-white font-bold text-xs">C</div>
          <span className="font-bold text-slate-900">Coverlog</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900">Set up your clinic</h1>
        <div>
          <label className={labelClass}>Clinic name</label>
          <input name="orgName" required placeholder="Clinic name" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Your name</label>
          <input name="adminName" required placeholder="Your name" className={inputClass} />
        </div>
        <button type="submit" className={`${btnPrimary} w-full`}>Create</button>
      </form>
    </div>
  );
}
