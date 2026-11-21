'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from './ui';
import { useT } from '@/lib/i18n';

export interface ImportButtonProps {
  url: string;
  label?: string;
  onDone?: (data: { sheet: string; added: number; updated: number; skipped?: number }) => void;
}

/** Uploads an .xlsx file to an import endpoint and reports the result. */
export default function ImportButton({ url, label = 'Import Excel', onDone }: ImportButtonProps) {
  const ref = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { t } = useT();
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await api.upload<{ sheet: string; added: number; updated: number; skipped?: number }>(url, file);
      toast(data.skipped
        ? t('Imported from "{sheet}": {added} added, {updated} updated, {skipped} skipped', { sheet: data.sheet, added: data.added, updated: data.updated, skipped: data.skipped })
        : t('Imported from "{sheet}": {added} added, {updated} updated', { sheet: data.sheet, added: data.added, updated: data.updated }));
      onDone?.(data);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <>
      <input ref={ref} type="file" className="file-input" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => upload(e.target.files?.[0])} />
      <button className="btn" disabled={busy} onClick={() => ref.current?.click()}>{busy ? t('Importing…') : t(label)}</button>
    </>
  );
}
