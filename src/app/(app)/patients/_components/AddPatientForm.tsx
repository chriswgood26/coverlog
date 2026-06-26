"use client";
import { addPatientAction } from "../actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export function AddPatientForm() {
  return (
    <form action={addPatientAction} className="flex flex-wrap gap-2">
      <input name="name" required placeholder="Patient name" className={`${inputClass} w-auto`} />
      <input name="memberId" placeholder="Member ID" className={`${inputClass} w-auto`} />
      <input name="primaryPayer" placeholder="Payer" className={`${inputClass} w-auto`} />
      <button type="submit" className={btnPrimary}>Add</button>
    </form>
  );
}
