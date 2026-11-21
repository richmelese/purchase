'use client';

import { Suspense, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { money, date, today } from '@/lib/format';
import { api } from '@/lib/api';
import {
  PageHeader, Card, Badge, Loading, Empty, Modal, Field, useFetch, useToast,
} from '@/components/ui';
import Icon from '@/components/icons';
import { useSession } from '@/components/session';
import { useLookups } from '@/components/lookups';
import { useT } from '@/lib/i18n';
import DateInput from '@/components/DateInput';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------
interface BankAccount {
  id: number;
  account_no: number;
  bank_name: string;
  account_name?: string | null;
  account_number?: string | null;
  currency?: string;
  opening_balance?: number;
  total_debit?: number;
  total_credit?: number;
  current_balance?: number;
  tx_count?: number;
  notes?: string | null;
}

interface BankTransaction {
  id: number;
  bank_account_id: number;
  row_no?: number | string;
  bank_code: string;
  value_date?: string | null;
  purchase_code_1?: string | null;
  purchase_code_2?: string | null;
  debit?: number;
  purchase_expected?: number;
  purchase_difference?: number;
  purchase_remark?: string | null;
  sales_code_1?: string | null;
  sales_code_2?: string | null;
  credit?: number;
  sales_expected?: number;
  sales_difference?: number;
  sales_remark?: string | null;
}

interface PurchaseReconRow {
  id: number;
  no: number;
  invoice_no: string;
  bank_codes?: string[];
  date: string;
  party_name?: string | null;
  party_tin?: string | null;
  receipt_no?: string | null;
  total_before_vat: number;
  vat_amount: number;
  grand_total: number;
  withholding?: number;
  expected_payment: number;
  amount_in_bank?: number;
  difference: number;
  status: string;
}

interface SaleReconRow {
  id: number;
  no: number;
  invoice_no: string;
  bank_codes?: string[];
  date: string;
  party_name?: string | null;
  party_tin?: string | null;
  receipt_no?: string | null;
  total_before_vat: number;
  vat_amount: number;
  grand_total: number;
  withholding?: number;
  expected_payment: number;
  amount_in_bank?: number;
  difference: number;
  status: string;
}

interface ReconSummary {
  total_balance?: number;
  debit?: {
    total_bank_debit?: number;
    expected_purchases?: number;
    variance?: number;
    reconciliation_rate?: number;
    reconciled_count?: number;
    purchases_count?: number;
  };
  credit?: {
    total_bank_credit?: number;
    expected_sales?: number;
    variance?: number;
    reconciliation_rate?: number;
    reconciled_count?: number;
    sales_count?: number;
  };
}

type TabKey = 'statement' | 'purchases' | 'sales' | 'accounts';

interface Filters {
  statement: { search: string };
  purchases: { search: string; status: string };
  sales: { search: string; status: string };
}

export default function ReconciliationPageWrapper() {
  return (
    <Suspense fallback={<Loading />}>
      <ReconciliationPage />
    </Suspense>
  );
}

function ReconciliationPage() {
  const { can } = useSession();
  const { t } = useT();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>((searchParams.get('tab') as TabKey) || 'statement');
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  // Each tab keeps its own search box and status filter.
  const [filters, setFilters] = useState<Filters>({ statement: { search: '' }, purchases: { search: '', status: 'all' }, sales: { search: '', status: 'all' } });
  const setFilter = <T extends keyof Filters>(tab: T, key: keyof Filters[T], value: string) => setFilters((f) => ({ ...f, [tab]: { ...f[tab], [key]: value } }));

  // Modals state
  const [showTxModal, setShowTxModal] = useState(false);
  const [editingTx, setEditingTx] = useState<Partial<BankTransaction> | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Partial<BankAccount> | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [matchingInProgress, setMatchingInProgress] = useState(false);

  // Fetch summary and accounts
  const { data: summary, reload: reloadSummary } = useFetch<ReconSummary>('/reconciliation/summary');
  const { data: accounts, reload: reloadAccounts } = useFetch<BankAccount[]>('/reconciliation/banks');

  // Determine current selected account
  const currentAccount = useMemo(() => {
    if (!accounts || !accounts.length) return null;
    if (selectedAccountId) {
      return accounts.find((a) => a.id === Number(selectedAccountId)) || accounts[0];
    }
    return accounts[0];
  }, [accounts, selectedAccountId]);

  // Fetch transactions for selected account
  const {
    data: transactions,
    loading: loadingTx,
    error: errorTx,
    reload: reloadTx,
  } = useFetch<BankTransaction[]>(
    currentAccount ? `/reconciliation/transactions?bankAccountId=${currentAccount.id}&search=${encodeURIComponent(filters.statement.search)}` : null,
    [currentAccount?.id],
  );

  // Fetch purchases reconciliation
  const {
    data: purchasesRec,
    loading: loadingPur,
    error: errorPur,
    reload: reloadPur,
  } = useFetch<PurchaseReconRow[]>(`/reconciliation/purchases?status=${filters.purchases.status}&search=${encodeURIComponent(filters.purchases.search)}`);

  // Fetch sales reconciliation
  const {
    data: salesRec,
    loading: loadingSal,
    error: errorSal,
    reload: reloadSal,
  } = useFetch<SaleReconRow[]>(`/reconciliation/sales?status=${filters.sales.status}&search=${encodeURIComponent(filters.sales.search)}`);

  const reloadAll = () => {
    reloadSummary();
    reloadAccounts();
    reloadTx();
    reloadPur();
    reloadSal();
  };

  // Run auto-match
  const handleAutoMatch = async () => {
    setMatchingInProgress(true);
    try {
      const res = await api.post<{ total_matched: number; matched_purchases: number; matched_sales: number }>('/reconciliation/auto-match');
      toast(t('Auto-matched {total} transactions ({purchases} purchases, {sales} sales)', { total: res.total_matched, purchases: res.matched_purchases, sales: res.matched_sales }));
      reloadAll();
    } catch (err: any) {
      toast(err.message || t('Auto-match failed'), 'error');
    } finally {
      setMatchingInProgress(false);
    }
  };

  // Delete transaction
  const handleDeleteTx = async (txId: number) => {
    if (!window.confirm(t('Are you sure you want to delete this bank statement entry?'))) return;
    try {
      await api.del(`/reconciliation/transactions/${txId}`);
      toast(t('Transaction deleted'));
      reloadAll();
    } catch (err: any) {
      toast(err.message || t('Delete failed'), 'error');
    }
  };

  return (
    <>
      <PageHeader
        title={t('Bank Reconciliation')}
        subtitle={t('Match bank debits (purchases) and credits (sales) across Ethiopian bank accounts')}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('reconciliation', 'create', 'create_bank_tx') && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingTx(null);
              setShowTxModal(true);
            }}
          >
            <Icon name="plus" size={16} /> {t('New Entry')}
          </button>
          )}
          {can('reconciliation', 'edit', 'run_automatch') && (
          <button
            className="btn"
            onClick={handleAutoMatch}
            disabled={matchingInProgress}
            title={t('Automatically link matching transactions by exact amount')}
          >
            <Icon name="trendUp" size={16} /> {matchingInProgress ? t('Matching...') : t('Auto-Match')}
          </button>
          )}
          {can('reconciliation', 'create', 'import_bank') && (
          <button className="btn" onClick={() => setShowImportModal(true)}>
            <Icon name="upload" size={16} /> {t('Import Form')}
          </button>
          )}
          {can('reconciliation', 'export') && (
          <a className="btn" href="/api/reconciliation/export" download>
            <Icon name="download" size={16} /> {t('Export Form')}
          </a>
          )}
        </div>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="stat-label">{t('Total Bank Balance')}</div>
          <div className="stat-value" style={{ color: 'var(--brand-2)' }}>
            {t('ETB')} {money(summary?.total_balance || 0)}
          </div>
          <div className="stat-sub">{t('Across {n} Bank Accounts', { n: accounts?.length || 0 })}</div>
        </div>

        <div className="card stat">
          <div className="stat-label">{t('Purchases (Debits) vs Expected')}</div>
          <div className="stat-value">
            {t('ETB')} {money(summary?.debit?.total_bank_debit || 0)}
          </div>
          <div className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{t('Exp: {amount}', { amount: money(summary?.debit?.expected_purchases || 0) })}</span>
            <Badge
              tone={Math.abs(summary?.debit?.variance || 0) < 0.01 ? 'good' : 'warn'}
            >
              {t('Diff: {amount}', { amount: money(summary?.debit?.variance || 0) })}
            </Badge>
          </div>
        </div>

        <div className="card stat">
          <div className="stat-label">{t('Sales (Credits) vs Expected')}</div>
          <div className="stat-value">
            {t('ETB')} {money(summary?.credit?.total_bank_credit || 0)}
          </div>
          <div className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{t('Exp: {amount}', { amount: money(summary?.credit?.expected_sales || 0) })}</span>
            <Badge
              tone={Math.abs(summary?.credit?.variance || 0) < 0.01 ? 'good' : 'warn'}
            >
              {t('Diff: {amount}', { amount: money(summary?.credit?.variance || 0) })}
            </Badge>
          </div>
        </div>

        <div className="card stat">
          <div className="stat-label">{t('Reconciliation Progress')}</div>
          <div className="stat-value" style={{ color: 'var(--good)' }}>
            {summary?.debit?.reconciliation_rate || 0}% / {summary?.credit?.reconciliation_rate || 0}%
          </div>
          <div className="stat-sub">
            {t('P: {done}/{total}', { done: summary?.debit?.reconciled_count || 0, total: summary?.debit?.purchases_count || 0 })} · {t('S: {done}/{total}', { done: summary?.credit?.reconciled_count || 0, total: summary?.credit?.sales_count || 0 })}
          </div>
        </div>
      </div>

      {/* Top Navigation Tabs */}
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button
          className={`tab ${activeTab === 'statement' ? 'active' : ''}`}
          onClick={() => setActiveTab('statement')}
        >
          <Icon name="bank" size={15} /> {t('Bank Statements (Bank 01 - 10)')}
        </button>
        <button
          className={`tab ${activeTab === 'purchases' ? 'active' : ''}`}
          onClick={() => setActiveTab('purchases')}
        >
          <Icon name="purchases" size={15} /> {t('Purchases Reconciliation')}
          {purchasesRec ? ` (${purchasesRec.length})` : ''}
        </button>
        <button
          className={`tab ${activeTab === 'sales' ? 'active' : ''}`}
          onClick={() => setActiveTab('sales')}
        >
          <Icon name="sales" size={15} /> {t('Sales Reconciliation')}
          {salesRec ? ` (${salesRec.length})` : ''}
        </button>
        <button
          className={`tab ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          <Icon name="settings" size={15} /> {t('Bank Accounts Setup')}
        </button>
      </div>

      {/* Tab 1: Bank Statements */}
      {activeTab === 'statement' && (
        <div>
          {/* Account selector pills */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              paddingBottom: 10,
              marginBottom: 14,
            }}
          >
            {(accounts || []).map((acc) => {
              const isSel = currentAccount?.id === acc.id;
              return (
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: isSel ? '2px solid var(--brand-2)' : '1px solid var(--border)',
                    background: isSel ? 'var(--brand-soft)' : 'var(--surface)',
                    color: isSel ? 'var(--brand-2)' : 'var(--text)',
                    fontWeight: isSel ? 600 : 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{t('Bank {no}:', { no: String(acc.account_no).padStart(2, '0') })}</span>
                  <span>{acc.bank_name}</span>
                  <span
                    style={{
                      fontSize: 12,
                      padding: '2px 6px',
                      borderRadius: 10,
                      background: isSel ? 'var(--brand-2)' : 'var(--surface-2)',
                      color: isSel ? '#fff' : 'var(--text-2)',
                    }}
                  >
                    {money(acc.current_balance)}
                  </span>
                </button>
              );
            })}
          </div>

          {currentAccount && (
            <Card
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span>
                    {t('Bank {no}', { no: String(currentAccount.account_no).padStart(2, '0') })} — {currentAccount.bank_name} ({currentAccount.account_name || t('Operating Account')})
                  </span>
                  {currentAccount.account_number && (
                    <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 400 }}>
                      {t('Acc: {number}', { number: currentAccount.account_number })}
                    </span>
                  )}
                </div>
              }
              actions={
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="search"
                    placeholder={t('Search codes, remarks...')}
                    value={filters.statement.search}
                    onChange={(e) => setFilter('statement', 'search', e.target.value)}
                    style={{ padding: '6px 12px', fontSize: 13, width: 200 }}
                  />
                  {can('reconciliation', 'create', 'create_bank_tx') && (
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setEditingTx({ bank_account_id: currentAccount.id });
                      setShowTxModal(true);
                    }}
                  >
                    <Icon name="plus" size={14} /> {t('Add Entry')}
                  </button>
                  )}
                  {can('reconciliation', 'edit') && (
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setEditingAccount(currentAccount);
                      setShowAccountModal(true);
                    }}
                  >
                    <Icon name="settings" size={14} /> {t('Edit Bank')}
                  </button>
                  )}
                </div>
              }
            >
              {loadingTx ? (
                <Loading error={errorTx} />
              ) : !transactions || !transactions.length ? (
                <Empty>
                  {t('No transactions recorded for Bank {no} ({bank}).', { no: String(currentAccount.account_no).padStart(2, '0'), bank: currentAccount.bank_name })}
                  <br />
                  {t('Click "Add Entry" or "Import Form" to add bank entries.')}
                </Empty>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 45 }}>#</th>
                        <th>{t('Bank Code')}</th>
                        <th>{t('Value Date')}</th>
                        <th style={{ background: 'rgba(59, 71, 214, 0.05)' }}>{t('Pur. Code 1 & 2')}</th>
                        <th className="num" style={{ background: 'rgba(59, 71, 214, 0.05)' }}>{t('Debit (Paid)')}</th>
                        <th className="num" style={{ background: 'rgba(59, 71, 214, 0.05)' }}>{t('Expected')}</th>
                        <th className="num" style={{ background: 'rgba(59, 71, 214, 0.05)' }}>{t('Diff')}</th>
                        <th style={{ background: 'rgba(235, 104, 52, 0.05)' }}>{t('Sales Code 1 & 2')}</th>
                        <th className="num" style={{ background: 'rgba(235, 104, 52, 0.05)' }}>{t('Credit (Recv)')}</th>
                        <th className="num" style={{ background: 'rgba(235, 104, 52, 0.05)' }}>{t('Expected')}</th>
                        <th className="num" style={{ background: 'rgba(235, 104, 52, 0.05)' }}>{t('Diff')}</th>
                        <th style={{ width: 80 }}>{t('Actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td>{tx.row_no}</td>
                          <td>
                            <strong>{tx.bank_code}</strong>
                          </td>
                          <td>{date(tx.value_date) || '—'}</td>

                          {/* Purchase Debit Side */}
                          <td style={{ background: 'rgba(59, 71, 214, 0.02)' }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {tx.purchase_code_1 && (
                                <span className="tag" style={{ background: 'var(--brand-soft)', color: 'var(--brand-2)' }}>
                                  {tx.purchase_code_1}
                                </span>
                              )}
                              {tx.purchase_code_2 && (
                                <span className="tag" style={{ background: 'var(--brand-soft)', color: 'var(--brand-2)' }}>
                                  {tx.purchase_code_2}
                                </span>
                              )}
                              {!tx.purchase_code_1 && !tx.purchase_code_2 && <span style={{ color: 'var(--muted)' }}>—</span>}
                            </div>
                            {tx.purchase_remark && (
                              <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{tx.purchase_remark}</div>
                            )}
                          </td>
                          <td className="num" style={{ background: 'rgba(59, 71, 214, 0.02)' }}>
                            {(tx.debit ?? 0) > 0 ? money(tx.debit) : '—'}
                          </td>
                          <td className="num" style={{ background: 'rgba(59, 71, 214, 0.02)', color: 'var(--text-2)' }}>
                            {(tx.purchase_expected ?? 0) > 0 ? money(tx.purchase_expected) : '—'}
                          </td>
                          <td className="num" style={{ background: 'rgba(59, 71, 214, 0.02)' }}>
                            {(tx.debit ?? 0) > 0 ? (
                              <Badge tone={Math.abs(tx.purchase_difference ?? 0) < 0.01 ? 'good' : 'bad'}>
                                {money(tx.purchase_difference)}
                              </Badge>
                            ) : (
                              '—'
                            )}
                          </td>

                          {/* Sales Credit Side */}
                          <td style={{ background: 'rgba(235, 104, 52, 0.02)' }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {tx.sales_code_1 && (
                                <span className="tag" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                                  {tx.sales_code_1}
                                </span>
                              )}
                              {tx.sales_code_2 && (
                                <span className="tag" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                                  {tx.sales_code_2}
                                </span>
                              )}
                              {!tx.sales_code_1 && !tx.sales_code_2 && <span style={{ color: 'var(--muted)' }}>—</span>}
                            </div>
                            {tx.sales_remark && (
                              <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{tx.sales_remark}</div>
                            )}
                          </td>
                          <td className="num" style={{ background: 'rgba(235, 104, 52, 0.02)' }}>
                            {(tx.credit ?? 0) > 0 ? money(tx.credit) : '—'}
                          </td>
                          <td className="num" style={{ background: 'rgba(235, 104, 52, 0.02)', color: 'var(--text-2)' }}>
                            {(tx.sales_expected ?? 0) > 0 ? money(tx.sales_expected) : '—'}
                          </td>
                          <td className="num" style={{ background: 'rgba(235, 104, 52, 0.02)' }}>
                            {(tx.credit ?? 0) > 0 ? (
                              <Badge tone={Math.abs(tx.sales_difference ?? 0) < 0.01 ? 'good' : 'bad'}>
                                {money(tx.sales_difference)}
                              </Badge>
                            ) : (
                              '—'
                            )}
                          </td>

                          {/* Row Actions */}
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {can('reconciliation', 'edit') && (
                              <button
                                className="side-btn"
                                onClick={() => {
                                  setEditingTx(tx);
                                  setShowTxModal(true);
                                }}
                                title={t('Edit entry')}
                              >
                                {t('Edit')}
                              </button>
                              )}
                              {can('reconciliation', 'delete') && (
                              <button
                                className="side-btn"
                                style={{ color: 'var(--bad)' }}
                                onClick={() => handleDeleteTx(tx.id)}
                                title={t('Delete entry')}
                              >
                                &times;
                              </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* Tab 2: Purchases Reconciliation View */}
      {activeTab === 'purchases' && (
        <Card
          title={t('Purchases Bank Reconciliation')}
          actions={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={filters.purchases.status}
                onChange={(e) => setFilter('purchases', 'status', e.target.value)}
                style={{ padding: '6px 10px', fontSize: 13 }}
              >
                <option value="all">{t('All Statuses')}</option>
                <option value="reconciled">{t('Reconciled')}</option>
                <option value="partial">{t('Partial')}</option>
                <option value="unreconciled">{t('Unreconciled')}</option>
                <option value="overpaid">{t('Overpaid')}</option>
              </select>
              <input
                type="search"
                placeholder={t('Search purchase, TIN, supplier...')}
                value={filters.purchases.search}
                onChange={(e) => setFilter('purchases', 'search', e.target.value)}
                style={{ padding: '6px 12px', fontSize: 13, width: 220 }}
              />
            </div>
          }
        >
          {loadingPur ? (
            <Loading error={errorPur} />
          ) : !purchasesRec || !purchasesRec.length ? (
            <Empty>{t('No purchase records found matching your filters.')}</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('Purchase Code')}</th>
                    <th>{t('Bank Code(s)')}</th>
                    <th>{t('Date')}</th>
                    <th>{t('Supplier / TIN')}</th>
                    <th>{t('Receipt No')}</th>
                    <th className="num">{t('Before VAT')}</th>
                    <th className="num">{t('VAT (15%)')}</th>
                    <th className="num">{t('Total')}</th>
                    <th className="num">{t('WH')}</th>
                    <th className="num">{t('Expected @ Bank')}</th>
                    <th className="num">{t('Amount In Bank')}</th>
                    <th className="num">{t('Diff')}</th>
                    <th>{t('Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {purchasesRec.map((p) => (
                    <tr key={p.id}>
                      <td>{p.no}</td>
                      <td>
                        <Link href={`/purchases/${p.id}`} style={{ fontWeight: 600 }}>
                          {p.invoice_no}
                        </Link>
                      </td>
                      <td>
                        {p.bank_codes && p.bank_codes.length ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {p.bank_codes.map((bc) => (
                              <span key={bc} className="tag" style={{ background: 'var(--brand-soft)', color: 'var(--brand-2)' }}>
                                {bc}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td>{date(p.date)}</td>
                      <td>
                        <div>{p.party_name || '—'}</div>
                        {p.party_tin && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('TIN')}: {p.party_tin}</div>}
                      </td>
                      <td>{p.receipt_no || '—'}</td>
                      <td className="num">{money(p.total_before_vat)}</td>
                      <td className="num">{money(p.vat_amount)}</td>
                      <td className="num">{money(p.grand_total)}</td>
                      <td className="num">{(p.withholding ?? 0) > 0 ? money(p.withholding) : '—'}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{money(p.expected_payment)}</td>
                      <td className="num">{(p.amount_in_bank ?? 0) > 0 ? money(p.amount_in_bank) : '—'}</td>
                      <td className="num">
                        <span style={p.difference !== 0 ? { color: 'var(--bad)', fontWeight: 600 } : { color: 'var(--good)' }}>
                          {money(p.difference)}
                        </span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            p.status === 'Reconciled'
                              ? 'good'
                              : p.status === 'Partial'
                              ? 'warn'
                              : 'bad'
                          }
                        >
                          {t(p.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Tab 3: Sales Reconciliation View */}
      {activeTab === 'sales' && (
        <Card
          title={t('Sales Bank Reconciliation')}
          actions={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={filters.sales.status}
                onChange={(e) => setFilter('sales', 'status', e.target.value)}
                style={{ padding: '6px 10px', fontSize: 13 }}
              >
                <option value="all">{t('All Statuses')}</option>
                <option value="reconciled">{t('Reconciled')}</option>
                <option value="partial">{t('Partial')}</option>
                <option value="unreconciled">{t('Unreconciled')}</option>
                <option value="overcollected">{t('Overcollected')}</option>
              </select>
              <input
                type="search"
                placeholder={t('Search sales, TIN, customer...')}
                value={filters.sales.search}
                onChange={(e) => setFilter('sales', 'search', e.target.value)}
                style={{ padding: '6px 12px', fontSize: 13, width: 220 }}
              />
            </div>
          }
        >
          {loadingSal ? (
            <Loading error={errorSal} />
          ) : !salesRec || !salesRec.length ? (
            <Empty>{t('No sales records found matching your filters.')}</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('Sales Code')}</th>
                    <th>{t('Bank Code(s)')}</th>
                    <th>{t('Date')}</th>
                    <th>{t('Customer / TIN')}</th>
                    <th>{t('Receipt No')}</th>
                    <th className="num">{t('Before VAT')}</th>
                    <th className="num">{t('VAT (15%)')}</th>
                    <th className="num">{t('Total')}</th>
                    <th className="num">{t('WH')}</th>
                    <th className="num">{t('Expected @ Bank')}</th>
                    <th className="num">{t('Amount In Bank')}</th>
                    <th className="num">{t('Diff')}</th>
                    <th>{t('Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {salesRec.map((s) => (
                    <tr key={s.id}>
                      <td>{s.no}</td>
                      <td>
                        <Link href={`/sales/${s.id}`} style={{ fontWeight: 600 }}>
                          {s.invoice_no}
                        </Link>
                      </td>
                      <td>
                        {s.bank_codes && s.bank_codes.length ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {s.bank_codes.map((bc) => (
                              <span key={bc} className="tag" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                                {bc}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td>{date(s.date)}</td>
                      <td>
                        <div>{s.party_name || '—'}</div>
                        {s.party_tin && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('TIN')}: {s.party_tin}</div>}
                      </td>
                      <td>{s.receipt_no || '—'}</td>
                      <td className="num">{money(s.total_before_vat)}</td>
                      <td className="num">{money(s.vat_amount)}</td>
                      <td className="num">{money(s.grand_total)}</td>
                      <td className="num">{(s.withholding ?? 0) > 0 ? money(s.withholding) : '—'}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{money(s.expected_payment)}</td>
                      <td className="num">{(s.amount_in_bank ?? 0) > 0 ? money(s.amount_in_bank) : '—'}</td>
                      <td className="num">
                        <span style={s.difference !== 0 ? { color: 'var(--bad)', fontWeight: 600 } : { color: 'var(--good)' }}>
                          {money(s.difference)}
                        </span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            s.status === 'Reconciled'
                              ? 'good'
                              : s.status === 'Partial'
                              ? 'warn'
                              : 'bad'
                          }
                        >
                          {t(s.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Tab 4: Bank Accounts Setup */}
      {activeTab === 'accounts' && (
        <Card
          title={t('Bank Accounts Configuration (Bank 01 to Bank 10)')}
          actions={can('reconciliation', 'create') && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setEditingAccount({
                  account_no: (accounts?.length || 0) + 1,
                  bank_name: 'CBE',
                  account_name: `Bank ${String((accounts?.length || 0) + 1).padStart(2, '0')}`,
                  currency: 'ETB',
                  opening_balance: 0,
                });
                setShowAccountModal(true);
              }}
            >
              <Icon name="plus" size={14} /> {t('Add Bank Account')}
            </button>
          )
          }
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('No.')}</th>
                  <th>{t('Bank Institution')}</th>
                  <th>{t('Account Name')}</th>
                  <th>{t('Account Number')}</th>
                  <th className="num">{t('Opening Bal.')}</th>
                  <th className="num">{t('Debits (Out)')}</th>
                  <th className="num">{t('Credits (In)')}</th>
                  <th className="num">{t('Current Balance')}</th>
                  <th>{t('Transactions')}</th>
                  <th>{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {(accounts || []).map((acc) => (
                  <tr key={acc.id}>
                    <td>
                      <strong>{t('Bank {no}', { no: String(acc.account_no).padStart(2, '0') })}</strong>
                    </td>
                    <td>
                      <span className="badge badge-brand">{acc.bank_name}</span>
                    </td>
                    <td>{acc.account_name}</td>
                    <td>{acc.account_number || '—'}</td>
                    <td className="num">{money(acc.opening_balance)}</td>
                    <td className="num">{money(acc.total_debit)}</td>
                    <td className="num">{money(acc.total_credit)}</td>
                    <td className="num" style={{ fontWeight: 700, color: 'var(--brand-2)' }}>
                      {money(acc.current_balance)}
                    </td>
                    <td>{t('{n} rows', { n: acc.tx_count ?? 0 })}</td>
                    <td>
                      {can('reconciliation', 'edit') && (
                      <button
                        className="side-btn"
                        onClick={() => {
                          setEditingAccount(acc);
                          setShowAccountModal(true);
                        }}
                      >
                        {t('Edit')}
                      </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Transaction Modal (Add / Edit Bank Entry) */}
      {showTxModal && (
        <TransactionModal
          tx={editingTx}
          accounts={accounts || []}
          defaultAccountId={currentAccount?.id}
          onClose={() => setShowTxModal(false)}
          onSaved={() => {
            setShowTxModal(false);
            reloadAll();
          }}
        />
      )}

      {/* Account Setup Modal */}
      {showAccountModal && (
        <AccountModal
          account={editingAccount}
          onClose={() => setShowAccountModal(false)}
          onSaved={() => {
            setShowAccountModal(false);
            reloadAll();
          }}
        />
      )}

      {/* Excel Import Modal */}
      {showImportModal && (
        <ImportWorkbookModal
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            setShowImportModal(false);
            reloadAll();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Transaction Modal Component
// ---------------------------------------------------------------------------
interface TransactionForm {
  bank_account_id: number;
  row_no: number | string;
  bank_code: string;
  value_date: string;
  purchase_code_1: string;
  purchase_code_2: string;
  debit: number | string;
  purchase_remark: string;
  sales_code_1: string;
  sales_code_2: string;
  credit: number | string;
  sales_remark: string;
}

interface TransactionModalProps {
  tx: Partial<BankTransaction> | null;
  accounts: BankAccount[];
  defaultAccountId?: number;
  onClose: () => void;
  onSaved: () => void;
}

function TransactionModal({ tx, accounts, defaultAccountId, onClose, onSaved }: TransactionModalProps) {
  const toast = useToast();
  const { t } = useT();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<Record<string, any>>({});

  const [form, setForm] = useState<TransactionForm>({
    bank_account_id: tx?.bank_account_id || defaultAccountId || accounts[0]?.id || 1,
    row_no: tx?.row_no || '',
    bank_code: tx?.bank_code || '',
    value_date: tx?.value_date || today(),
    purchase_code_1: tx?.purchase_code_1 || '',
    purchase_code_2: tx?.purchase_code_2 || '',
    debit: tx?.debit || '',
    purchase_remark: tx?.purchase_remark || '',
    sales_code_1: tx?.sales_code_1 || '',
    sales_code_2: tx?.sales_code_2 || '',
    credit: tx?.credit || '',
    sales_remark: tx?.sales_remark || '',
  });

  const save = async () => {
    setSaving(true);
    setErr({});
    try {
      if (tx?.id) {
        await api.put(`/reconciliation/transactions/${tx.id}`, form);
        toast(t('Bank entry updated'));
      } else {
        await api.post('/reconciliation/transactions', form);
        toast(t('Bank entry recorded'));
      }
      onSaved();
    } catch (e: any) {
      setErr({ _: e.message, ...(e.fields || {}) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      width={720}
      title={tx?.id ? t('Edit Bank Entry ({code})', { code: tx.bank_code }) : t('New Bank Statement Entry')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? t('Saving...') : tx?.id ? t('Update Entry') : t('Save Entry')}
          </button>
        </>
      }
    >
      {err._ && <div className="alert alert-error">{err._}</div>}

      <div className="grid grid-3" style={{ gap: 12, marginBottom: 16 }}>
        <Field label={t('Bank Account')} error={err.bank_account_id}>
          <select
            value={form.bank_account_id}
            onChange={(e) => setForm({ ...form, bank_account_id: Number(e.target.value) })}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {t('Bank {no}:', { no: String(a.account_no).padStart(2, '0') })} {a.bank_name} ({a.account_name})
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('Bank Code')} hint={t('Leave blank to auto-generate')} error={err.bank_code}>
          <input
            placeholder={t('e.g. {example}', { example: 'CBE001' })}
            value={form.bank_code}
            onChange={(e) => setForm({ ...form, bank_code: e.target.value })}
          />
        </Field>

        <Field label={t('Value Date')} error={err.value_date}>
          <DateInput value={form.value_date} invalid={!!err.value_date} onChange={(v) => setForm({ ...form, value_date: v })} />
        </Field>
      </div>

      {/* Side by side: Purchases (Debit) vs Sales (Credit) */}
      <div className="grid grid-2" style={{ gap: 16 }}>
        {/* Purchases (Debit) Section */}
        <div style={{ background: 'rgba(59, 71, 214, 0.03)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
          <h3 style={{ marginBottom: 10, color: 'var(--brand-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="purchases" size={16} /> {t('Outgoing Payment (Debit)')}
          </h3>
          <div className="grid" style={{ gap: 10 }}>
            <Field label={t('Purchase Code 1')} hint={t('e.g. {a} or {b}', { a: 'P0001', b: 'P00001' })}>
              <input
                placeholder="P0001"
                value={form.purchase_code_1}
                onChange={(e) => setForm({ ...form, purchase_code_1: e.target.value })}
              />
            </Field>
            <Field label={t('Purchase Code 2 (optional)')}>
              <input
                placeholder="P0002"
                value={form.purchase_code_2}
                onChange={(e) => setForm({ ...form, purchase_code_2: e.target.value })}
              />
            </Field>
            <Field label={t('Debit Amount (ETB)')} error={err.debit}>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={form.debit}
                onChange={(e) => setForm({ ...form, debit: e.target.value })}
              />
            </Field>
            <Field label={t('Debit Remark')}>
              <input
                placeholder={t('Check #, supplier name, etc.')}
                value={form.purchase_remark}
                onChange={(e) => setForm({ ...form, purchase_remark: e.target.value })}
              />
            </Field>
          </div>
        </div>

        {/* Sales (Credit) Section */}
        <div style={{ background: 'rgba(235, 104, 52, 0.03)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
          <h3 style={{ marginBottom: 10, color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="sales" size={16} /> {t('Incoming Receipt (Credit)')}
          </h3>
          <div className="grid" style={{ gap: 10 }}>
            <Field label={t('Sales Code 1')} hint={t('e.g. {a} or {b}', { a: 'S0001', b: 'S00001' })}>
              <input
                placeholder="S0001"
                value={form.sales_code_1}
                onChange={(e) => setForm({ ...form, sales_code_1: e.target.value })}
              />
            </Field>
            <Field label={t('Sales Code 2 (optional)')}>
              <input
                placeholder="S0002"
                value={form.sales_code_2}
                onChange={(e) => setForm({ ...form, sales_code_2: e.target.value })}
              />
            </Field>
            <Field label={t('Credit Amount (ETB)')} error={err.credit}>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={form.credit}
                onChange={(e) => setForm({ ...form, credit: e.target.value })}
              />
            </Field>
            <Field label={t('Credit Remark')}>
              <input
                placeholder={t('Deposit slip, customer, etc.')}
                value={form.sales_remark}
                onChange={(e) => setForm({ ...form, sales_remark: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Account Setup Modal Component
// ---------------------------------------------------------------------------
interface AccountForm {
  account_no: number;
  bank_name: string;
  account_name: string;
  account_number: string;
  currency: string;
  opening_balance: number | string;
  notes: string;
}

interface AccountModalProps {
  account: Partial<BankAccount> | null;
  onClose: () => void;
  onSaved: () => void;
}

function AccountModal({ account, onClose, onSaved }: AccountModalProps) {
  const toast = useToast();
  const { t } = useT();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<Record<string, any>>({});

  // Banks come from the "Banks (Ethiopian)" list in Settings › Dropdown lists.
  const lk = useLookups();
  const bankOptions = useMemo(() => {
    const configured = lk.options('bank');
    // Keep an account's saved bank selectable even if it was later removed from the list.
    const saved = account?.bank_name;
    return saved && !configured.some((o) => o.value === saved) ? [{ value: saved, label: saved }, ...configured] : configured;
  }, [lk, account?.bank_name]);

  const [form, setForm] = useState<AccountForm>({
    account_no: account?.account_no || 1,
    bank_name: account?.bank_name || '',
    account_name: account?.account_name || '',
    account_number: account?.account_number || '',
    currency: account?.currency || 'ETB',
    opening_balance: account?.opening_balance || 0,
    notes: account?.notes || '',
  });

  const save = async () => {
    setSaving(true);
    setErr({});
    try {
      if (account?.id) {
        await api.put(`/reconciliation/banks/${account.id}`, form);
        toast(t('Bank account updated'));
      } else {
        await api.post('/reconciliation/banks', form);
        toast(t('Bank account added'));
      }
      onSaved();
    } catch (e: any) {
      setErr({ _: e.message, ...(e.fields || {}) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      width={520}
      title={account?.id ? t('Configure Bank {no}', { no: String(account.account_no).padStart(2, '0') }) : t('New Bank Account')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? t('Saving...') : t('Save Account')}
          </button>
        </>
      }
    >
      {err._ && <div className="alert alert-error">{err._}</div>}
      <div className="grid" style={{ gap: 12 }}>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label={t('Account Tab Number')} error={err.account_no}>
            <input
              type="number"
              min="1"
              max="99"
              value={form.account_no}
              onChange={(e) => setForm({ ...form, account_no: Number(e.target.value) })}
              disabled={!!account?.id}
            />
          </Field>
          <Field label={t('Bank Institution')} error={err.bank_name}>
            <select
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
            >
              <option value="">{t('Choose a bank')}</option>
              {bankOptions.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.value} — {b.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={t('Account Display Name')} error={err.account_name}>
          <input
            placeholder={t('e.g. Main Operating Account')}
            value={form.account_name}
            onChange={(e) => setForm({ ...form, account_name: e.target.value })}
          />
        </Field>

        <Field label={t('Bank Account Number')} error={err.account_number}>
          <input
            placeholder={t('e.g. {example}', { example: '1000123456789' })}
            value={form.account_number}
            onChange={(e) => setForm({ ...form, account_number: e.target.value })}
          />
        </Field>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label={t('Opening Balance (ETB)')} error={err.opening_balance}>
            <input
              type="number"
              step="0.01"
              value={form.opening_balance}
              onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
            />
          </Field>
          <Field label={t('Currency')}>
            <input
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            />
          </Field>
        </div>

        <Field label={t('Notes / Branch Info')}>
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Import Workbook Modal Component
// ---------------------------------------------------------------------------
interface ImportWorkbookModalProps {
  onClose: () => void;
  onImported: () => void;
}

function ImportWorkbookModal({ onClose, onImported }: ImportWorkbookModalProps) {
  const toast = useToast();
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleUploadFile = async (file: File | null | undefined) => {
    if (!file) return;
    setImporting(true);
    setErr(null);
    try {
      const data = await api.upload<{ total_imported: number }>('/reconciliation/import', file);
      toast(t('Successfully imported {n} bank transactions!', { n: data.total_imported }));
      onImported();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      width={540}
      title={t('Import Bank Reconciliation Form (.xlsx)')}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>{t('Close')}</button>}
    >
      {err && <div className="alert alert-error">{err}</div>}

      <div style={{ textAlign: 'center', padding: '20px 12px' }}>
        <p style={{ color: 'var(--text-2)', marginBottom: 20 }}>
          {t('Upload your EC Bank Reconciliation Form workbook.')}
          <br />
          {t('The system reads statements from the Bank 01 to Bank 10 sheets and synchronizes debit and credit transactions.')}
        </p>

        <input
          type="file"
          accept=".xlsx"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={(e) => handleUploadFile(e.target.files?.[0])}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            style={{ padding: '12px 24px', fontSize: 14, width: '100%', maxWidth: 440 }}
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <Icon name="upload" size={18} />
            {importing ? t('Processing workbook...') : t('Choose .xlsx workbook…')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
