"use client";
import { importCsvAction, exportCsvAction } from "../actions";

export function CsvControls() {
  async function download() {
    const csv = await exportCsvAction();
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "patients.csv"; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="flex gap-2">
      <form action={importCsvAction}><input type="file" name="file" accept=".csv" className="text-sm" /><button className="ml-1 rounded border px-2 py-1 text-sm">Import</button></form>
      <button onClick={download} className="rounded border px-2 py-1 text-sm">Export</button>
    </div>
  );
}
