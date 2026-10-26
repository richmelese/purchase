import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DatabaseService } from '../../db/database.service';
import type { AuthUser } from '../../common/auth.guard';
import { logActivity } from '../../common/activity-log';
import { UNITS } from '../../common/calc';

export interface ImportResult { sheet: string; added: number; updated: number; skipped: number }

const normalizeHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const v: any = cell.value;
  if (v == null) return '';
  let s: string;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) s = v.richText.map((t: any) => t.text).join('');
    else if (v.text != null) s = String(v.text);
    else if (v.result != null) s = String(v.result);
    else if (v instanceof Date) s = v.toISOString().slice(0, 10);
    else s = String(v);
  } else {
    s = String(v);
  }
  return s.trim();
}

function headerMap(row: ExcelJS.Row): Record<string, number> {
  const map: Record<string, number> = {};
  row.eachCell((cell, colNumber) => {
    const key = normalizeHeader(cellText(cell));
    if (key && map[key] === undefined) map[key] = colNumber;
  });
  return map;
}

function findCol(map: Record<string, number>, keys: string[]): number | undefined {
  for (const k of keys) if (map[k] !== undefined) return map[k];
  return undefined;
}

function parseUnit(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && raw.trim() !== '') return n;
  const found = UNITS.find((u) => u.label.toLowerCase() === raw.trim().toLowerCase());
  return found ? found.value : null;
}

async function loadFirstSheet(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new BadRequestException('Expected a raw .xlsx file in the request body');
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch {
    throw new BadRequestException('Could not read the uploaded file as an .xlsx workbook');
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new BadRequestException('The uploaded workbook has no worksheets');
  return sheet;
}

@Injectable()
export class ImportService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Upserts by TIN. Reads either the workbook's "Supplier Lists" sheet (Company TIN, Company Name,
   * MRC-1/2/3, phone, email) or a file previously produced by GET /api/export/list/parties.
   */
  async importParties(buffer: Buffer, type: 'Supplier' | 'Customer', user?: AuthUser): Promise<ImportResult> {
    const sheet = await loadFirstSheet(buffer);
    const map = headerMap(sheet.getRow(1));
    const tinCol = findCol(map, ['companytin', 'tin']);
    const nameCol = findCol(map, ['companyname', 'name']);
    if (!nameCol) throw new BadRequestException('Could not find a Company Name column in the uploaded sheet');
    const mrc1Col = findCol(map, ['mrc1']);
    const mrc2Col = findCol(map, ['mrc2']);
    const mrc3Col = findCol(map, ['mrc3']);
    const phoneCol = findCol(map, ['phone']);
    const emailCol = findCol(map, ['email']);

    let added = 0, updated = 0, skipped = 0;
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const tin = tinCol ? cellText(row.getCell(tinCol)) : '';
      const name = cellText(row.getCell(nameCol));
      if (!tin && !name) continue; // fully blank row, not even counted
      if (!name) { skipped++; continue; }
      const mrc1 = mrc1Col ? cellText(row.getCell(mrc1Col)) : '';
      const mrc2 = mrc2Col ? cellText(row.getCell(mrc2Col)) : '';
      const mrc3 = mrc3Col ? cellText(row.getCell(mrc3Col)) : '';
      const phone = phoneCol ? cellText(row.getCell(phoneCol)) : '';
      const email = emailCol ? cellText(row.getCell(emailCol)) : '';

      const existing = tin ? this.db.get<{ id: number }>('SELECT id FROM parties WHERE tin = ?', [tin]) : undefined;
      if (existing) {
        this.db.run(
          `UPDATE parties SET name = ?, mrc1 = ?, mrc2 = ?, mrc3 = ?,
             phone = COALESCE(NULLIF(?, ''), phone), email = COALESCE(NULLIF(?, ''), email), updated_at = datetime('now')
           WHERE id = ?`,
          [name, mrc1, mrc2, mrc3, phone, email, existing.id],
        );
        updated++;
      } else {
        this.db.run(
          'INSERT INTO parties (tin, name, type, mrc1, mrc2, mrc3, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [tin || null, name, type, mrc1, mrc2, mrc3, phone, email],
        );
        added++;
      }
    }
    logActivity(this.db, user, 'other', 'parties', null, `imported ${added + updated} ${type.toLowerCase()}s (${added} added, ${updated} updated)`);
    return { sheet: sheet.name, added, updated, skipped };
  }

  /**
   * Upserts by product code. Reads either the workbook's "Product Lists" sheet or a file previously
   * produced by GET /api/export/list/products. `current_stock`/`status` columns (computed, not stored)
   * are read but ignored on import.
   */
  async importProducts(buffer: Buffer, user?: AuthUser): Promise<ImportResult> {
    const sheet = await loadFirstSheet(buffer);
    const map = headerMap(sheet.getRow(1));
    const codeCol = findCol(map, ['code']);
    if (!codeCol) throw new BadRequestException('Could not find a Code column in the uploaded sheet');
    const nameEnCol = findCol(map, ['nameenglish', 'englishname', 'name']);
    const nameAmCol = findCol(map, ['nameamharic', 'amharicname']);
    const categoryCol = findCol(map, ['category']);
    const brandCol = findCol(map, ['brand']);
    const modelCol = findCol(map, ['model']);
    const serialCol = findCol(map, ['serialno', 'serial']);
    const unitCol = findCol(map, ['unit']);
    const minCol = findCol(map, ['minstock']);
    const openingCol = findCol(map, ['openingstock']);
    const purchaseCol = findCol(map, ['purchaseprice']);
    const sellingCol = findCol(map, ['sellingprice']);

    let added = 0, updated = 0, skipped = 0;
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const code = cellText(row.getCell(codeCol));
      const nameEn = nameEnCol ? cellText(row.getCell(nameEnCol)) : '';
      if (!code && !nameEn) continue; // fully blank row
      if (!code) { skipped++; continue; }
      const name_am = nameAmCol ? cellText(row.getCell(nameAmCol)) : '';
      const category = categoryCol ? cellText(row.getCell(categoryCol)) : '';
      const brand = brandCol ? cellText(row.getCell(brandCol)) : '';
      const model = modelCol ? cellText(row.getCell(modelCol)) : '';
      const serial_no = serialCol ? cellText(row.getCell(serialCol)) : '';
      const unit = unitCol ? parseUnit(cellText(row.getCell(unitCol))) : null;
      const min_stock = minCol ? Number(cellText(row.getCell(minCol))) || 0 : 0;
      const opening_stock = openingCol ? Number(cellText(row.getCell(openingCol))) || 0 : 0;
      const purchase_price = purchaseCol ? Number(cellText(row.getCell(purchaseCol))) || 0 : 0;
      const selling_price = sellingCol ? Number(cellText(row.getCell(sellingCol))) || 0 : 0;

      const existing = this.db.get<{ id: number }>('SELECT id FROM products WHERE code = ?', [code]);
      if (existing) {
        this.db.run(
          `UPDATE products SET name_en = COALESCE(NULLIF(?, ''), name_en), name_am = ?, category = ?, brand = ?,
             model = ?, serial_no = ?, unit = COALESCE(?, unit), min_stock = ?, opening_stock = ?,
             purchase_price = ?, selling_price = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [nameEn, name_am, category, brand, model, serial_no, unit, min_stock, opening_stock, purchase_price, selling_price, existing.id],
        );
        updated++;
      } else {
        this.db.run(
          `INSERT INTO products (code, name_en, name_am, category, brand, model, serial_no, unit, min_stock, opening_stock, purchase_price, selling_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [code, nameEn || code, name_am, category, brand, model, serial_no, unit, min_stock, opening_stock, purchase_price, selling_price],
        );
        added++;
      }
    }
    logActivity(this.db, user, 'other', 'products', null, `imported ${added + updated} products (${added} added, ${updated} updated)`);
    return { sheet: sheet.name, added, updated, skipped };
  }
}
