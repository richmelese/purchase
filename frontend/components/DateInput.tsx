'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { EC_MONTHS, toEthiopian, toGregorian } from '@/lib/shared/ethiopian';
import { gcDate } from '@/lib/format';

/** Day / Ethiopian month / year picker. Value in and out is always a Gregorian ISO date (YYYY-MM-DD). */
export function EthiopianDateInput({ value, onChange, invalid, required }: {
  value: string; onChange: (v: string) => void; invalid?: boolean; required?: boolean;
}) {
  const { t } = useT();
  const ec = toEthiopian(value) || { year: '' as any, month: 1, day: 1 };
  const [parts, setParts] = useState(ec);
  useEffect(() => { setParts(toEthiopian(value) || parts); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (p: Partial<typeof parts>) => {
    const next = { ...parts, ...p };
    setParts(next);
    const g = toGregorian(next.year, next.month, next.day);
    if (g) onChange(g);
  };
  return (
    <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
      <input type="number" min="1" max="30" value={parts.day} required={required} onChange={(e) => update({ day: +e.target.value })} style={{ width: 64 }} aria-label={t('EC day')} className={invalid ? 'invalid' : ''} />
      <select value={parts.month} onChange={(e) => update({ month: +e.target.value })} aria-label={t('EC month')}>
        {EC_MONTHS.map((m, i) => <option key={m} value={i + 1}>{t(m)}</option>)}
      </select>
      <input type="number" min="1900" max="2200" value={parts.year} onChange={(e) => update({ year: +e.target.value as any })} style={{ width: 84 }} aria-label={t('EC year')} />
    </div>
  );
}

/**
 * Date field in the user's calendar: Ethiopian picker in Amharic, the browser's Gregorian picker in English.
 * Stored value is always Gregorian ISO. In Amharic the Gregorian equivalent is shown underneath.
 */
export default function DateInput({ value, onChange, invalid, required, className }: {
  value: string; onChange: (v: string) => void; invalid?: boolean; required?: boolean; className?: string;
}) {
  const { t, lang } = useT();
  if (lang !== 'am') {
    return <input type="date" value={value} required={required} className={[className, invalid ? 'invalid' : ''].filter(Boolean).join(' ')} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div>
      <EthiopianDateInput value={value} onChange={onChange} invalid={invalid} required={required} />
      {value && <div className="small muted" style={{ marginTop: 2 }}>{gcDate(value)} {t('GC')}</div>}
    </div>
  );
}
