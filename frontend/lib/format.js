import { formatEthiopian } from './shared/ethiopian.js';

const moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const qtyFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

export const money = (n) => moneyFmt.format(Number(n) || 0);
export const compact = (n) => compactFmt.format(Number(n) || 0);
export const qty = (n) => qtyFmt.format(Number(n) || 0);
export const etb = (n) => `ETB ${money(n)}`;

export function date(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}
export const ecDate = (iso) => formatEthiopian(iso);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---- amount in words (for printed invoices) ---------------------------------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

function under1000(n) {
  const out = [];
  if (n >= 100) { out.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')); } else if (n > 0) out.push(ONES[n]);
  return out.join(' ');
}

/** 103500.5 -> "One Hundred Three Thousand Five Hundred Birr and 50/100" */
export function amountInWords(value) {
  const n = Math.round((Number(value) || 0) * 100);
  let whole = Math.floor(Math.abs(n) / 100);
  const cents = Math.abs(n) % 100;
  const parts = [];
  if (whole === 0) parts.push('Zero');
  for (let i = 0; whole > 0 && i < SCALES.length; i++) {
    const chunk = whole % 1000;
    if (chunk) parts.unshift(`${under1000(chunk)}${SCALES[i] ? ` ${SCALES[i]}` : ''}`);
    whole = Math.floor(whole / 1000);
  }
  return `${n < 0 ? 'Minus ' : ''}${parts.join(' ')} Birr and ${String(cents).padStart(2, '0')}/100`;
}
