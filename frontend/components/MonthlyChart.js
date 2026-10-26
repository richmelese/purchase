'use client';

import { useEffect, useRef, useState } from 'react';
import { money, compact } from '@/lib/format';

const H = 280;     // fixed plot height; width follows the container
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };
const MAX_BAR = 24;  // column thickness cap
const GAP = 2;       // surface gap between touching columns
const R = 4;         // rounded data-end

function niceMax(v) {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

// Column with a rounded top and a square base.
function column(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(R, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** series: [{ name, color, values: number[] }] */
export default function MonthlyChart({ labels, series }) {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const band = iw / labels.length;
  const BAR = Math.max(8, Math.min(MAX_BAR, Math.floor((band * 0.6 - GAP) / series.length)));
  const groupW = series.length * BAR + (series.length - 1) * GAP;
  const y = (v) => PAD.top + ih - (v / max) * ih;

  const show = (e, label, s, v) => {
    const box = e.currentTarget.closest('.chart').getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ x: r.left - box.left + r.width / 2, y: r.top - box.top, label, name: s.name, value: v });
  };

  return (
    <div className="chart" ref={ref}>
      <div className="legend" style={{ marginBottom: 8 }}>
        {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${series.map((s) => s.name).join(' and ')} by month`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth="1" />
            <text className="tick" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{compact(t)}</text>
          </g>
        ))}
        {labels.map((label, i) => {
          const gx = PAD.left + band * i + (band - groupW) / 2;
          return (
            <g key={label}>
              {series.map((s, j) => {
                const v = s.values[i] || 0;
                const x = gx + j * (BAR + GAP);
                const top = y(v);
                return (
                  <g key={s.name}>
                    {/* larger invisible hit target */}
                    <rect x={x - 1} y={PAD.top} width={BAR + 2} height={ih} fill="transparent"
                      tabIndex={0} aria-label={`${label}, ${s.name}: ${money(v)}`}
                      onPointerMove={(e) => show(e, label, s, v)} onFocus={(e) => show(e, label, s, v)}
                      onPointerLeave={() => setTip(null)} onBlur={() => setTip(null)} />
                    <path className="bar" d={column(x, top, BAR, PAD.top + ih - top)} fill={s.color} pointerEvents="none" />
                  </g>
                );
              })}
              <text className="tick" x={PAD.left + band * i + band / 2} y={H - 8} textAnchor="middle">{label.slice(0, 3)}</text>
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
          <strong>ETB {money(tip.value)}</strong>
          <span className="muted">{tip.name} · {tip.label}</span>
        </div>
      )}
    </div>
  );
}
