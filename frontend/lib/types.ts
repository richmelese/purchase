// Shared domain shapes returned by the backend, used across InvoiceView/InvoiceForm/PrintInvoice/
// InvoiceList so these don't drift into 3 slightly different ad-hoc shapes.
import type { WithholdingResult, VatWithholdingResult } from './shared/calc';

export interface InvoiceLine {
  id: number;
  line_no: number;
  product_code: string | null;
  description: string | null;
  unit: number | null;
  tx_type: number | null;
  transaction_type: string;
  qty: number;
  unit_price: number;
  excise_rate: number;
  vatable_service_fee: number;
  non_vatable_fee: number;
  total: number;
  excise_amount: number;
  taxable_amount: number;
  vat_amount: number;
  line_total: number;
}

export interface InvoicePayment {
  id: number;
  date: string;
  method: string | null;
  reference: string | null;
  amount: number;
  crv_no: number;
}

export interface InvoiceDetail {
  id: number;
  kind: 'P' | 'S';
  invoice_no: string;
  date: string;
  fy: number;
  fy_month: number;
  party_name: string | null;
  party_tin: string | null;
  party_id: number | null;
  receipt_type: string;
  vat_receipt_no: string | null;
  mrc_number: string | null;
  payment_type: string;
  vat_category: string;
  calendar_type: string;
  report_status: string;
  taxable_amount: number;
  vat_amount: number;
  grand_total: number;
  balance: number;
  total_amount: number;
  excise_amount: number;
  vatable_service_fee: number;
  non_vatable_fee: number;
  amount_due: number;
  amount_paid: number;
  wh: WithholdingResult;
  vat_wh: VatWithholdingResult;
  wh_receipt_type: string | null;
  wh_receipt_no: string | null;
  wh_receipt_date: string | null;
  wh_paid: number;
  wh_reason_note: string | null;
  vat_wh_applicable: boolean;
  vat_wh_paid: number;
  notes: string | null;
  created_by: string | number | null;
  updated_by: string | number | null;
  created_at: string;
  updated_at: string;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
}

export interface Party {
  id: number;
  tin: string | null;
  name: string;
  type: 'Supplier' | 'Customer' | 'Both';
  mrc1?: string | null;
  mrc2?: string | null;
  mrc3?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  merged_into_id?: number | null;
  [key: string]: unknown;
}

export interface Product {
  id: number;
  code: string;
  name_en: string;
  name_am?: string | null;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  serial_no?: string | null;
  unit?: number | null;
  track_stock?: boolean | number;
  min_stock?: number;
  opening_stock?: number;
  purchase_price?: number;
  selling_price?: number;
  current_stock?: number;
  notes?: string | null;
  [key: string]: unknown;
}
