"use client";
import { logCheckAction } from "../actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export function LogCheckDrawer({ patientId }: { patientId: string }) {
  return (
    <form action={logCheckAction} className="flex flex-wrap gap-2 bg-white rounded-2xl border border-slate-200 p-4">
      <input type="hidden" name="patientId" value={patientId} />
      <input name="payer" placeholder="Payer" className={`${inputClass} w-auto`} />
      <select name="status" className={`${inputClass} w-auto`} defaultValue="verified">
        <option value="verified">verified</option><option value="pending">pending</option><option value="inactive">inactive</option>
      </select>
      <input name="copay" type="number" step="0.01" placeholder="Copay" className={`${inputClass} w-24`} />
      <input name="deductible" type="number" step="0.01" placeholder="Deductible left" className={`${inputClass} w-36`} />
      <input name="nextDue" type="date" className={`${inputClass} w-auto`} />
      <input name="notes" placeholder="Notes" className={`${inputClass} w-auto`} />
      <button type="submit" className={btnPrimary}>Log check</button>
    </form>
  );
}
