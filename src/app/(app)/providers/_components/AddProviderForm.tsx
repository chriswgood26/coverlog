import { createProviderAction } from "../actions";

export function AddProviderForm() {
  return (
    <form action={createProviderAction} className="flex flex-wrap gap-2">
      <input name="name" required placeholder="Provider name" className="border p-1" />
      <input name="npi" placeholder="NPI" className="border p-1 w-32" />
      <input name="licenseType" placeholder="License (LCSW…)" className="border p-1 w-32" />
      <input name="licenseNumber" placeholder="License #" className="border p-1 w-28" />
      <input name="licenseState" placeholder="State" className="border p-1 w-16" />
      <input name="licenseExpiration" type="date" className="border p-1" />
      <button className="rounded bg-black px-2 py-1 text-white text-sm">Add provider</button>
    </form>
  );
}
