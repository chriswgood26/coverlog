import { createProviderAction } from "../actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export function AddProviderForm() {
  return (
    <form action={createProviderAction} className="flex flex-wrap gap-2 bg-white rounded-2xl border border-slate-200 p-4">
      <input name="name" required placeholder="Provider name" className={`${inputClass} w-auto`} />
      <input name="npi" placeholder="NPI" className={`${inputClass} w-32`} />
      <input name="specialty" placeholder="Specialty" className={`${inputClass} w-40`} />
      <input name="licenseType" placeholder="License (LCSW…)" className={`${inputClass} w-36`} />
      <input name="licenseNumber" placeholder="License #" className={`${inputClass} w-28`} />
      <input name="licenseState" placeholder="State" className={`${inputClass} w-20`} />
      <input name="licenseExpiration" type="date" className={`${inputClass} w-auto`} />
      <select name="status" defaultValue="active" className={`${inputClass} w-auto`}>
        <option value="active">active</option>
        <option value="pending">pending</option>
        <option value="flagged">flagged</option>
      </select>
      <button className={btnPrimary}>Add provider</button>
    </form>
  );
}
