import { formatEthiopian } from './shared/ethiopian';
import { getLang, tx } from './i18n/core';

const moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const qtyFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

export const money = (n: unknown): string => moneyFmt.format(Number(n) || 0);
export const compact = (n: unknown): string => compactFmt.format(Number(n) || 0);
export const qty = (n: unknown): string => qtyFmt.format(Number(n) || 0);
export const etb = (n: unknown): string => `ETB ${money(n)}`;

// ---- dates follow the language: English → Gregorian (GC), Amharic → Ethiopian (E.C.) ----------
// Stored dates are always Gregorian ISO (YYYY-MM-DD); only the display changes.

/** Gregorian, always: 11/20/2026 */
export function gcDate(iso: unknown): string {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}
/** Ethiopian, always: "11 ኅዳር 2019" (month name follows the language). */
export const ecDate = (iso: unknown): string => formatEthiopian(iso);

/** The date in the user's calendar: GC in English, E.C. (with ዓ.ም) in Amharic. Use this for display. */
export function date(iso: unknown): string {
  if (!iso) return '';
  if (getLang() === 'am') {
    const ec = ecDate(iso);
    return ec ? `${ec} ${tx('E.C.')}` : gcDate(iso);
  }
  return gcDate(iso);
}
/** The same date in the *other* calendar, for an optional second line: E.C. in English, GC in Amharic. */
export function otherDate(iso: unknown): string {
  if (!iso) return '';
  return getLang() === 'am' ? `${gcDate(iso)} ${tx('GC')}` : `${ecDate(iso)} ${tx('E.C.')}`;
}

/**
 * Time of day. English: 3:05 PM. Amharic: Ethiopian clock, which starts counting at 6 AM —
 * 7:00 AM → ጠዋት 1:00, 3:05 PM → ከሰዓት 9:05, 9:00 PM → ምሽት 3:00, 2:00 AM → ሌሊት 8:00.
 */
export function time(d: Date): string {
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (getLang() !== 'am') return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  const ecHour = ((h + 6) % 12) || 12;
  const part = h >= 6 && h < 12 ? 'ጠዋት' : h >= 12 && h < 18 ? 'ከሰዓት' : h >= 18 ? 'ምሽት' : 'ሌሊት';
  return `${part} ${ecHour}:${mm}`;
}

/** Date + time from a Date or a timestamp string (server "YYYY-MM-DD HH:MM:SS" is UTC). */
export function dateTime(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(value);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${date(iso)} ${time(d)}`;
}
export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---- amount in words (for printed invoices) ---------------------------------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

function under1000(n: number): string {
  const out: string[] = [];
  if (n >= 100) { out.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')); } else if (n > 0) out.push(ONES[n]);
  return out.join(' ');
}

/** 103500.5 -> "One Hundred Three Thousand Five Hundred Birr and 50/100" */
export function amountInWords(value: unknown): string {
  const n = Math.round((Number(value) || 0) * 100);
  let whole = Math.floor(Math.abs(n) / 100);
  const cents = Math.abs(n) % 100;
  const parts: string[] = [];
  if (whole === 0) parts.push('Zero');
  for (let i = 0; whole > 0 && i < SCALES.length; i++) {
    const chunk = whole % 1000;
    if (chunk) parts.unshift(`${under1000(chunk)}${SCALES[i] ? ` ${SCALES[i]}` : ''}`);
    whole = Math.floor(whole / 1000);
  }
  return `${n < 0 ? 'Minus ' : ''}${parts.join(' ')} Birr and ${String(cents).padStart(2, '0')}/100`;
}
