"use client";
import { useState } from "react";
import { createProviderAction } from "../actions";
import { inputClass, labelClass, btnPrimary, btnSecondary } from "@/lib/ui";

export function AddProviderModal() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={btnPrimary}>+ Add provider</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Add provider</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
            </div>
            <form action={createProviderAction} onSubmit={() => setOpen(false)} className="space-y-3">
              <div>
                <label className={labelClass}>Name</label>
                <input name="name" required placeholder="Provider name" className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelClass}>NPI</label><input name="npi" className={inputClass} /></div>
                <div><label className={labelClass}>Specialty</label><input name="specialty" className={inputClass} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelClass}>License type</label><input name="licenseType" placeholder="LCSW…" className={inputClass} /></div>
                <div><label className={labelClass}>License #</label><input name="licenseNumber" className={inputClass} /></div>
                <div><label className={labelClass}>State</label><input name="licenseState" className={inputClass} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelClass}>Expiration</label><input name="licenseExpiration" type="date" className={inputClass} /></div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select name="status" defaultValue="active" className={inputClass}>
                    <option value="active">active</option>
                    <option value="pending">pending</option>
                    <option value="flagged">flagged</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>Cancel</button>
                <button type="submit" className={btnPrimary}>Add provider</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
