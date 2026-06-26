"use client";
import { useActionState } from "react";
import { addPatientAction } from "../actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export function AddPatientForm() {
  const [state, formAction, pending] = useActionState(addPatientAction, null);
  return (
    <div className="space-y-1.5">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input name="name" required placeholder="Patient name" className={`${inputClass} flex-1 min-w-[160px]`} />
        <input name="memberId" placeholder="Member ID" className={`${inputClass} flex-1 min-w-[140px]`} />
        <input name="primaryPayer" placeholder="Payer" className={`${inputClass} flex-1 min-w-[140px]`} />
        <button type="submit" disabled={pending} className={`${btnPrimary} disabled:opacity-60`}>
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-xs text-emerald-600">Patient added.</p>}
    </div>
  );
}
