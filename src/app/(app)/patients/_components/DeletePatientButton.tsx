"use client";
import { deletePatientAction } from "../actions";
import { btnDangerText } from "@/lib/ui";

export function DeletePatientButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deletePatientAction}
      onSubmit={(e) => {
        if (!window.confirm(`Remove ${name}? This hides the patient from the list.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={btnDangerText}>Remove</button>
    </form>
  );
}
