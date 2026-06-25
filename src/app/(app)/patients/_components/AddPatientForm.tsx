"use client";
import { addPatientAction } from "../actions";

export function AddPatientForm() {
  return (
    <form action={addPatientAction} className="flex gap-2">
      <input name="name" required placeholder="Patient name" className="border p-2" />
      <input name="memberId" placeholder="Member ID" className="border p-2" />
      <input name="primaryPayer" placeholder="Payer" className="border p-2" />
      <button type="submit" className="rounded bg-black px-3 py-2 text-white">Add</button>
    </form>
  );
}
