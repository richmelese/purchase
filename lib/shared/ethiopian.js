// Ethiopian calendar conversion and tax-period helpers.
// Shared by the server (Node) and the browser.
//
// The Ethiopian fiscal / VAT year runs Hamle (month 11) -> Sene (month 10).
// Pagume (month 13, 5-6 days) is folded into Nehase for tax reporting,
// exactly as the original workbook does (Nehase = Aug 7 - Sep 10).

export const EC_MONTHS = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume',
];

// Order of months inside one fiscal year (index 0..11).
export const FY_MONTHS = [
  'Hamle', 'Nehase', 'Meskerem', 'Tikimt', 'Hidar', 'Tahsas',
  'Tir', 'Yekatit', 'Megabit', 'Miazia', 'Ginbot', 'Sene',
];

const EC_EPOCH = 1723856; // JDN offset used by the standard conversion

function gregorianToJdn(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4)
    - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function jdnToGregorian(jdn) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor(1461 * d / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

function ethiopianToJdn(y, m, d) {
  return EC_EPOCH + 365 + 365 * (y - 1) + Math.floor(y / 4) + 30 * m + d - 31;
}

function jdnToEthiopian(jdn) {
  const r = (jdn - EC_EPOCH) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor((jdn - EC_EPOCH) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** '2026-09-30' -> { year: 2019, month: 1, day: 20 } */
export function toEthiopian(iso) {
  const g = parseIso(iso);
  if (!g) return null;
  return jdnToEthiopian(gregorianToJdn(g.year, g.month, g.day));
}

/** Ethiopian y/m/d -> '2026-09-30' (returns null for an invalid EC date) */
export function toGregorian(year, month, day) {
  year = +year; month = +month; day = +day;
  if (!year || month < 1 || month > 13 || day < 1) return null;
  const maxDay = month === 13 ? (year % 4 === 3 ? 6 : 5) : 30;
  if (day > maxDay) return null;
  const g = jdnToGregorian(ethiopianToJdn(year, month, day));
  return `${g.year}-${pad(g.month)}-${pad(g.day)}`;
}

/** Human-readable Ethiopian date: '20 Meskerem 2019' */
export function formatEthiopian(iso) {
  const e = toEthiopian(iso);
  return e ? `${e.day} ${EC_MONTHS[e.month - 1]} ${e.year}` : '';
}

/**
 * Tax period for a Gregorian date.
 * fy      – fiscal year number (the EC year in which Sene falls, e.g. 2019)
 * idx     – 0..11 position inside FY_MONTHS
 * month   – month name used for the declaration
 */
export function taxPeriod(iso) {
  const e = toEthiopian(iso);
  if (!e) return null;
  const m = e.month === 13 ? 12 : e.month; // Pagume -> Nehase
  const fy = m >= 11 ? e.year + 1 : e.year;
  const idx = m >= 11 ? m - 11 : m + 1;
  return { fy, idx, month: FY_MONTHS[idx], ecYear: e.year };
}

/** Fiscal year of today's date (or a given ISO date). */
export function currentFiscalYear(iso) {
  const d = iso || new Date().toISOString().slice(0, 10);
  return taxPeriod(d).fy;
}

/** Gregorian start/end (inclusive) of a fiscal-year month. */
export function periodRange(fy, idx) {
  const ecMonth = idx < 2 ? idx + 11 : idx - 1;
  const ecYear = idx < 2 ? fy - 1 : fy;
  const start = toGregorian(ecYear, ecMonth, 1);
  let end;
  if (idx === 1) end = toGregorian(ecYear, 13, ecYear % 4 === 3 ? 6 : 5); // Nehase incl. Pagume
  else end = toGregorian(ecYear, ecMonth, 30);
  return { start, end };
}

export function fiscalYearLabel(fy) {
  return `FY ${fy - 1}/${String(fy).slice(-2)} E.C.`;
}
