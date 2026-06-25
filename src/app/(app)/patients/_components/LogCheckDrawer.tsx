"use client";
import { logCheckAction } from "../actions";

export function LogCheckDrawer({ patientId }: { patientId: string }) {
  return (
    <form action={logCheckAction} className="flex flex-wrap gap-2 rounded border p-3">
      <input type="hidden" name="patientId" value={patientId} />
      <input name="payer" placeholder="Payer" className="border p-2" />
      <select name="status" className="border p-2" defaultValue="verified">
        <option value="verified">verified</option><option value="pending">pending</option><option value="inactive">inactive</option>
      </select>
      <input name="copay" type="number" step="0.01" placeholder="Copay" className="border p-2 w-24" />
      <input name="deductible" type="number" step="0.01" placeholder="Deductible left" className="border p-2 w-32" />
      <input name="nextDue" type="date" className="border p-2" />
      <input name="notes" placeholder="Notes" className="border p-2" />
      <button type="submit" className="rounded bg-black px-3 py-2 text-white">Log check</button>
    </form>
  );
}
