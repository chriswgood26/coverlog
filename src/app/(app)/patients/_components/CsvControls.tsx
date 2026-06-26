"use client";
import { importCsvAction, exportCsvAction } from "../actions";
import { btnSecondary } from "@/lib/ui";

export function CsvControls() {
  async function download() {
    const csv = await exportCsvAction();
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "patients.csv"; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="flex items-center gap-2">
      <form action={importCsvAction} className="flex items-center gap-1">
        <input type="file" name="file" accept=".csv" className="text-sm text-slate-600" />
        <button className={btnSecondary}>Import</button>
      </form>
      <button onClick={download} className={btnSecondary}>Export</button>
    </div>
  );
}
