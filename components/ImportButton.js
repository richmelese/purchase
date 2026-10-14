'use client';

import { useRef, useState } from 'react';
import { useToast } from './ui';

/** Uploads an .xlsx file to an import endpoint and reports the result. */
export default function ImportButton({ url, label = 'Import Excel', onDone }) {
  const ref = useRef(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await fetch(`/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Import failed');
      toast(`Imported from “${data.sheet}”: ${data.added} added, ${data.updated} updated${data.skipped ? `, ${data.skipped} skipped` : ''}`);
      onDone?.(data);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <>
      <input ref={ref} type="file" className="file-input" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => upload(e.target.files[0])} />
      <button className="btn" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Importing…' : label}</button>
    </>
  );
}
