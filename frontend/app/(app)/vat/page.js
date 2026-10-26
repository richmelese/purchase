'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { fiscalYearLabel } from '@/lib/shared/ethiopian';
import { PageHeader, Card, Loading, PeriodFilter, useFetch, useCurrentFy, useToast } from '@/components/ui';
import { useSession } from '@/components/session';

export default function VatPage() {
  const { can } = useSession();
  const toast = useToast();
  const currentFy = useCurrentFy();
  const [fy, setFy] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  useEffect(() => { if (currentFy && !fy) setFy(currentFy); }, [currentFy, fy]);
  const { data, error, setData } = useFetch(fy ? `/vat?fy=${fy}` : null);

  const startEdit = () => {
    const d = {};
    for (const l of data.lines) {
      if (l.kind === 'manual') l.values.forEach((v, i) => { d[`${l.no}:${i}`] = v || ''; });
    }
    d['195:0'] = data.openingCredit || '';
    setDraft(d);
    setEditing(true);
  };
  const save = async () => {
    const items = Object.entries(draft).map(([k, v]) => {
      const [line_no, fy_month] = k.split(':').map(Number);
      return { line_no, fy_month, amount: Number(v) || 0 };
    });
    try {
      setData(await api.put('/vat/adjustments', { fy, items }));
      setEditing(false);
      toast('Adjustments saved');
    } catch (e) { toast(e.message, 'error'); }
  };

  const editable = (l, i) => editing && (l.kind === 'manual' || (l.no === 195 && i === 0));

  return (
    <>
      <PageHeader title="VAT declaration summary" subtitle={`Monthly VAT return lines · ${fy ? fiscalYearLabel(fy) : ''}`}>
        <PeriodFilter fy={fy} showMonth={false} onChange={(p) => setFy(p.fy)} />
        {editing
          ? <><button className="btn" onClick={() => setEditing(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save adjustments</button></>
          : can('vat', 'edit') && <button className="btn" onClick={startEdit} disabled={!data}>Edit manual lines</button>}
        {can('vat', 'export') && <a className="btn" href={`/api/export/vat?fy=${fy || ''}`}>Export Excel</a>}
      </PageHeader>

      <div className="alert alert-info no-print">
        Lines are computed from recorded transactions by <em>Type of purchase / sales</em>. Reverse taxation, debit/credit notes,
        government vouchers, other credits and refunds are entered manually. Line 195 is carried forward automatically from the
        previous month&apos;s credit; enter the opening credit for Hamle when editing.
      </div>

      <Card fill bodyClass="">
        {!data ? <Loading error={error} /> : (
          <div className="table-wrap">
            <table className="vat-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Description</th>
                  <th className="num">Total</th>
                  {data.months.map((m) => <th key={m} className="num">{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.no} className={`${l.total !== undefined && l.kind === 'calc' && VAT_TOTAL.has(l.no) ? 'total' : ''} ${l.highlight ? 'highlight' : ''}`}>
                    <td>{l.no}</td>
                    <td>
                      {l.label}
                      {l.kind === 'manual' && <span className="muted small"> · manual</span>}
                    </td>
                    <td className="num"><strong>{money(l.total)}</strong></td>
                    {l.values.map((v, i) => (
                      <td key={i} className="num">
                        {editable(l, i)
                          ? <input type="number" step="any" value={draft[`${l.no}:${i}`] ?? ''} onChange={(e) => setDraft({ ...draft, [`${l.no}:${i}`]: e.target.value })} aria-label={`Line ${l.no} ${data.months[i]}`} />
                          : v ? money(v) : <span className="muted">–</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

const VAT_TOTAL = new Set([55, 60, 90, 95, 165, 170, 185, 190, 200, 205]);
