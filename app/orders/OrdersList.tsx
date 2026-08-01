"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { statusBadgeStyle, statusLabel, confirmationStatusOptions, deliveryOptions, urgencyTypeOptions, urgencyTypeOptionLabel, urgencyLabel, telHref, CALL_PENDING_STAGES, isHistoryDelivery } from '@/lib/theme';
import { NEEDS_REVIEW_REASON_LABELS } from '@/lib/orderValidation.mjs';
import { ATTEMPT_TYPES, ATTEMPT_MAX, ATTEMPT_TYPE_LABELS, isTerminalConfirmationStatus, formatAttemptsForDisplay } from '@/lib/contactAttempts.mjs';
import { formatDhakaDateTime } from '@/lib/dhakaTime.mjs';
import PaginationBar from '@/app/components/PaginationBar';
import FlagActions from '@/app/components/FlagActions';

type OrderItem = {
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
};

type ContactAttempt = {
  type: string;
  count: number;
  first_logged_at: string | null;
};

type OrderRow = {
  id: number;
  order_number: string | null;
  customer_name: string;
  phone: string;
  address: string;
  urgency_type: string;
  urgency_target_date: string | null;
  confirmation_status: string;
  delivery_status: string;
  created_at: string;
  total_amount: number | null;
  archived_at: string | null;
  needs_review: boolean;
  needs_review_reasons: string[] | null;
  visible_needs_review_reasons: string[];
  order_items: OrderItem[];
  contact_attempts: ContactAttempt[];
};

// Minimal inline icon (feather-icons-style path) for the dense table's Open action -- no icon
// library dependency for one glyph.
function OpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

type OrdersListProps = {
  orders: OrderRow[];
  view: string;
  bucket: 'active' | 'history';
  totalCount: number;
  page: number;
  pageSize: number;
  prevHref: string | null;
  nextHref: string | null;
  pageSizeHrefs: { size: number; href: string }[];
  itemLabel: string;
};

export default function OrdersList({ orders: initialOrders, view, bucket, totalCount: initialTotalCount, page, pageSize, prevHref, nextHref, pageSizeHrefs, itemLabel }: OrdersListProps) {
  const router = useRouter();
  // History, Cancelled, and Archived are resolved/inactive orders -- a compact card grid
  // (customer, phone, total, item summary only) instead of the detailed editable row Orders/
  // Call Pending/Needs Review use. Also drops urgency-based row coloring entirely, since
  // urgency is a live-workflow concern that doesn't apply to orders already done.
  const compact = bucket === 'history' || view === 'cancelled' || view === 'archived';
  // Orders (default view, incl. any urgency/confirmation/delivery filters) and Call Pending --
  // the two highest-traffic, most-scanned views -- get the dense single-line-per-order table.
  // Needs Review keeps the taller .order-row card below: its flag reasons + resolve/ignore
  // actions need more room per row than a table cell can hold.
  const isTableView = !compact && (view === '' || view === 'call-pending');
  const [orders, setOrders] = useState(initialOrders);
  // Local copy so instant client-side row removals (archiving, a delivery_status edit that
  // crosses the active/history boundary, a Call Pending row getting confirmed) can decrement
  // the displayed total immediately, instead of the "Showing X of Y" count looking stale until
  // the next full page load.
  const [totalCount, setTotalCount] = useState(initialTotalCount);

  // Switching views/pages/filters via the nav pills or pagination links is a client-side
  // navigation on the same route, so this component isn't remounted -- without this,
  // useState(initialOrders) would keep showing whatever filtered list was left over from the
  // previous view instead of the newly fetched orders for the new one.
  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);
  useEffect(() => {
    setTotalCount(initialTotalCount);
  }, [initialTotalCount]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [rowWarnings, setRowWarnings] = useState<Record<number, string>>({});
  // set only while a vu/d type is picked for a row but no day has been committed yet
  const [pendingUrgencyType, setPendingUrgencyType] = useState<Record<number, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const [archivingIds, setArchivingIds] = useState<Set<number>>(new Set());
  const [bulkArchiving, setBulkArchiving] = useState(false);
  const [bulkArchiveError, setBulkArchiveError] = useState('');

  const syncNow = async () => {
    setSyncing(true);
    setSyncMessage('');
    setSyncError('');

    try {
      const response = await fetch('/api/sync/sheet/trigger', { method: 'POST' });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        setSyncError(result.error || 'Sync failed');
        return;
      }

      const s = result.summary;
      setSyncMessage(`Synced: ${s.created} created, ${s.updated} updated, ${s.unchanged} unchanged, ${s.removed} removed, ${s.skipped} skipped, ${s.warnings} warnings, ${s.errors} errors`);
    } catch {
      setSyncError('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleFlagActioned = (orderId: number, flagType: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, visible_needs_review_reasons: o.visible_needs_review_reasons.filter((r) => r !== flagType) } : o
      )
    );
  };

  const updateField = async (orderId: number, field: 'confirmation_status' | 'delivery_status', value: string) => {
    const previous = orders.find((o) => o.id === orderId)?.[field];
    // moving to a terminal confirmation status wipes contact_attempts server-side (see
    // app/api/orders/route.ts) -- mirror that locally so the badge clears immediately
    const wipesAttempts = field === 'confirmation_status' && isTerminalConfirmationStatus(value);
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, [field]: value, ...(wipesAttempts ? { contact_attempts: [] } : {}) } : o)));
    setSavingIds((prev) => new Set(prev).add(orderId));
    setRowErrors((prev) => { const next = { ...prev }; delete next[orderId]; return next; });
    setRowWarnings((prev) => { const next = { ...prev }; delete next[orderId]; return next; });

    try {
      const response = await fetch(`/api/orders?id=${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderId, [field]: value }),
      });
      const result = await response.json();

      if (!response.ok) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, [field]: previous ?? o[field] } : o)));
        setRowErrors((prev) => ({ ...prev, [orderId]: result.error || 'Unable to save' }));
      } else {
        if (result.sheetSyncWarning) {
          setRowWarnings((prev) => ({ ...prev, [orderId]: result.sheetSyncWarning }));
        }

        // Call Pending only ever shows 'pending' orders -- once a row is marked to any terminal
        // status it no longer belongs here, so drop it from view immediately rather than
        // leaving it visible (with an updated badge) until the next full page load
        const leftCallPending = field === 'confirmation_status' && view === 'call-pending' && !CALL_PENDING_STAGES.includes(value);

        // /orders <-> /history split: a delivery_status edit that crosses the active/history
        // boundary (e.g. marking something "sent_to_courier" while on /orders, or "returned"
        // while on /history) means this row no longer belongs on whichever tab is currently
        // open -- drop it immediately rather than leaving a shipped order sitting in the active
        // queue (or a returned one stuck in history) until the next reload.
        const crossedBucket = field === 'delivery_status' && isHistoryDelivery(value) !== (bucket === 'history');

        if (leftCallPending || crossedBucket) {
          setOrders((prev) => prev.filter((o) => o.id !== orderId));
          setSelected((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
          setTotalCount((prev) => Math.max(0, prev - 1));
        }
      }
    } catch {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, [field]: previous ?? o[field] } : o)));
      setRowErrors((prev) => ({ ...prev, [orderId]: 'Unable to save' }));
    } finally {
      setSavingIds((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
    }
  };

  const [attemptLoggingIds, setAttemptLoggingIds] = useState<Set<string>>(new Set());

  const logAttempt = async (orderId: number, type: string) => {
    const key = `${orderId}:${type}`;
    setAttemptLoggingIds((prev) => new Set(prev).add(key));
    setRowErrors((prev) => { const next = { ...prev }; delete next[orderId]; return next; });
    setRowWarnings((prev) => { const next = { ...prev }; delete next[orderId]; return next; });

    try {
      const response = await fetch('/api/orders/attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, type }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        setRowErrors((prev) => ({ ...prev, [orderId]: result.error || 'Unable to log attempt' }));
        return;
      }

      if (result.sheetSyncWarning) {
        setRowWarnings((prev) => ({ ...prev, [orderId]: result.sheetSyncWarning }));
      }

      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, contact_attempts: result.data.attempts } : o)));
    } catch {
      setRowErrors((prev) => ({ ...prev, [orderId]: 'Unable to log attempt' }));
    } finally {
      setAttemptLoggingIds((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  };

  const archiveOne = async (orderId: number, archive: boolean) => {
    const label = orders.find((o) => o.id === orderId)?.customer_name ?? `order ${orderId}`;
    const confirmed = window.confirm(archive ? `Archive ${label}? It'll be hidden from normal views but can be restored anytime.` : `Restore ${label} back into normal views?`);
    if (!confirmed) return;

    setArchivingIds((prev) => new Set(prev).add(orderId));
    setRowErrors((prev) => { const next = { ...prev }; delete next[orderId]; return next; });

    try {
      const response = await fetch(`/api/orders?id=${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderId, archived_at: archive ? new Date().toISOString() : null }),
      });
      const result = await response.json();

      if (!response.ok) {
        setRowErrors((prev) => ({ ...prev, [orderId]: result.error || 'Unable to save' }));
        return;
      }

      // archiving hides a row from every non-archived view; restoring hides it from the
      // Archived view -- either way, whichever view is currently open no longer wants it
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      setSelected((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
      setTotalCount((prev) => Math.max(0, prev - 1));
    } catch {
      setRowErrors((prev) => ({ ...prev, [orderId]: 'Unable to save' }));
    } finally {
      setArchivingIds((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
    }
  };

  const bulkArchive = async (archive: boolean) => {
    if (selected.size === 0) return;
    const count = selected.size;
    const confirmed = window.confirm(
      archive
        ? `Archive ${count} selected order${count === 1 ? '' : 's'}? They'll be hidden from normal views but can be restored anytime.`
        : `Restore ${count} selected order${count === 1 ? '' : 's'} back into normal views?`,
    );
    if (!confirmed) return;

    setBulkArchiving(true);
    setBulkArchiveError('');

    try {
      const ids = Array.from(selected);
      const response = await fetch('/api/orders/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, archive }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        setBulkArchiveError(result.error || 'Bulk action failed');
        return;
      }

      const updated = new Set<number>(result.updatedIds);
      setOrders((prev) => prev.filter((o) => !updated.has(o.id)));
      setSelected(new Set());
      setTotalCount((prev) => Math.max(0, prev - updated.size));
    } catch {
      setBulkArchiveError('Bulk action failed');
    } finally {
      setBulkArchiving(false);
    }
  };

  const saveUrgency = async (orderId: number, type: string, day?: number) => {
    setSavingIds((prev) => new Set(prev).add(orderId));
    setRowErrors((prev) => { const next = { ...prev }; delete next[orderId]; return next; });
    setRowWarnings((prev) => { const next = { ...prev }; delete next[orderId]; return next; });

    try {
      const body: Record<string, unknown> = { id: orderId, urgency_type: type };
      if (day !== undefined) body.urgency_target_day = day;

      const response = await fetch(`/api/orders?id=${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();

      if (!response.ok) {
        setRowErrors((prev) => ({ ...prev, [orderId]: result.error || 'Unable to save' }));
        return;
      }

      if (result.sheetSyncWarning) {
        setRowWarnings((prev) => ({ ...prev, [orderId]: result.sheetSyncWarning }));
      }

      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, urgency_type: result.data.urgency_type, urgency_target_date: result.data.urgency_target_date } : o)));
      setPendingUrgencyType((prev) => { const next = { ...prev }; delete next[orderId]; return next; });
    } catch {
      setRowErrors((prev) => ({ ...prev, [orderId]: 'Unable to save' }));
    } finally {
      setSavingIds((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
    }
  };

  const handleUrgencyTypeChange = (orderId: number, newType: string) => {
    setPendingUrgencyType((prev) => ({ ...prev, [orderId]: newType }));
    setRowErrors((prev) => { const next = { ...prev }; delete next[orderId]; return next; });

    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    if (newType === 'vu' || newType === 'd') {
      if (order.urgency_target_date) {
        saveUrgency(orderId, newType, new Date(order.urgency_target_date).getUTCDate());
      }
      // otherwise wait for the day-of-month input
      return;
    }

    saveUrgency(orderId, newType);
  };

  const handleUrgencyDayCommit = (orderId: number, type: string, rawDay: string) => {
    if (!rawDay.trim()) return;
    const day = Number(rawDay);
    if (!Number.isFinite(day)) return;
    saveUrgency(orderId, type, day);
  };

  const allSelected = orders.length > 0 && selected.size === orders.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.id)));
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const exportSelected = async () => {
    if (selected.size === 0) return;
    setExporting(true);
    setExportError('');

    try {
      const response = await fetch('/api/orders/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setExportError(result.error || 'Export failed');
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PaginationBar
        variant="compact"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        visibleCount={orders.length}
        itemLabel={itemLabel}
        prevHref={prevHref}
        nextHref={nextHref}
        pageSizeHrefs={pageSizeHrefs}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Select all on this page
        </label>
        <span style={{ fontSize: '0.9rem', color: '#666' }}>{selected.size} selected</span>
        <button type="button" onClick={exportSelected} disabled={selected.size === 0 || exporting}>
          {exporting ? 'Exporting...' : 'Export Selected'}
        </button>
        {exportError ? <span style={{ color: '#c62828', fontSize: '0.9rem' }}>{exportError}</span> : null}
        <button type="button" onClick={() => bulkArchive(view !== 'archived')} disabled={selected.size === 0 || bulkArchiving}>
          {bulkArchiving ? 'Working...' : view === 'archived' ? 'Restore Selected' : 'Archive Selected'}
        </button>
        {bulkArchiveError ? <span style={{ color: '#c62828', fontSize: '0.9rem' }}>{bulkArchiveError}</span> : null}
        <button type="button" onClick={syncNow} disabled={syncing} style={{ marginLeft: 'auto' }}>
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
        {syncMessage ? <span style={{ color: '#2e7d32', fontSize: '0.85rem' }}>{syncMessage}</span> : null}
        {syncError ? <span style={{ color: '#c62828', fontSize: '0.9rem' }}>{syncError}</span> : null}
      </div>

      {isTableView ? (
        <div className="orders-table-wrap">
          <table className="orders-table">
            <colgroup>
              <col style={{ width: '3%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th></th>
                <th>Order</th>
                <th>Customer</th>
                <th>Address</th>
                <th>Items</th>
                <th>Urgency</th>
                <th>Status</th>
                <th>Delivery</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const items = order.order_items ?? [];
                const itemSummary = items.map((item) => `${item.quantity} × ${item.sku || item.product_name}`).join(', ');
                const computedSubtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
                const subtotal = order.total_amount ?? computedSubtotal;
                const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
                const itemsShort =
                  items.length === 0
                    ? 'No items'
                    : items.length === 1
                      ? `${items[0].quantity} × ${items[0].sku || items[0].product_name}`
                      : `${items[0].sku || items[0].product_name} +${items.length - 1} more`;

                const rowClassName =
                  order.urgency_type === 'urgent' || order.urgency_type === 'vu'
                    ? 'order-row order-row--urgent'
                    : order.urgency_type === 'hold'
                      ? 'order-row order-row--hold'
                      : 'order-row';
                const displayedUrgencyType = pendingUrgencyType[order.id] ?? order.urgency_type;
                const attemptsDisplay = formatAttemptsForDisplay(order.contact_attempts);
                const isTerminal = isTerminalConfirmationStatus(order.confirmation_status);
                const rowIssue = rowErrors[order.id] || rowWarnings[order.id];

                return (
                  <tr key={order.id} className={rowClassName}>
                    <td>
                      <input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleOne(order.id)} />
                    </td>
                    <td>
                      <div className="customer-name">{order.order_number ?? `#${order.id}`}</div>
                      <span className="customer-phone">{formatDhakaDateTime(order.created_at)}</span>
                    </td>
                    <td>
                      <div className="customer-name">{order.customer_name}</div>
                      <a href={telHref(order.phone)} className="customer-phone">{order.phone}</a>
                    </td>
                    <td className="orders-table-truncate" title={order.address}>
                      {order.address}
                    </td>
                    <td className="orders-table-truncate" title={itemSummary || 'No items'}>
                      {itemsShort}
                      {items.length > 0 ? <span style={{ color: 'var(--text-muted)' }}> ({totalQty})</span> : null}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'nowrap' }}>
                        <select
                          className="pill-select"
                          value={displayedUrgencyType}
                          onChange={(e) => handleUrgencyTypeChange(order.id, e.target.value)}
                          style={{ ...statusBadgeStyle(displayedUrgencyType), display: 'inline-block', flexShrink: 1, minWidth: 0 }}
                        >
                          {urgencyTypeOptions.map((type) => (
                            <option key={type} value={type}>{urgencyTypeOptionLabel(type)}</option>
                          ))}
                        </select>
                        {displayedUrgencyType === 'vu' || displayedUrgencyType === 'd' ? (
                          <input
                            type="number"
                            min="1"
                            max="31"
                            placeholder="Day"
                            key={`${order.id}-${order.urgency_target_date ?? 'unset'}`}
                            defaultValue={order.urgency_target_date ? new Date(order.urgency_target_date).getUTCDate() : ''}
                            onBlur={(e) => handleUrgencyDayCommit(order.id, displayedUrgencyType, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            style={{ width: '3rem', fontSize: '0.68rem', padding: '0.1rem 0.3rem', flexShrink: 0 }}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'nowrap' }}>
                        <select
                          className="pill-select"
                          value={order.confirmation_status}
                          onChange={(e) => updateField(order.id, 'confirmation_status', e.target.value)}
                          style={{ ...statusBadgeStyle(order.confirmation_status), display: 'inline-block', flexShrink: 1, minWidth: 0 }}
                          title={attemptsDisplay || undefined}
                        >
                          {confirmationStatusOptions.map((step) => (
                            <option key={step} value={step}>{statusLabel(step)}</option>
                          ))}
                        </select>
                        {!isTerminal ? (
                          <div style={{ display: 'flex', gap: '0.15rem', flexShrink: 0 }}>
                            {ATTEMPT_TYPES.map((type) => {
                              const count = order.contact_attempts.find((a) => a.type === type)?.count ?? 0;
                              const max = ATTEMPT_MAX[type as keyof typeof ATTEMPT_MAX];
                              const capped = count >= max;
                              const loading = attemptLoggingIds.has(`${order.id}:${type}`);
                              return (
                                <button
                                  key={type}
                                  type="button"
                                  className="attempt-mini-btn"
                                  onClick={() => logAttempt(order.id, type)}
                                  disabled={capped || loading}
                                  title={`${capped ? `${ATTEMPT_TYPE_LABELS[type]} is capped at ${max}` : `Log a ${ATTEMPT_TYPE_LABELS[type]} attempt`}${count > 0 ? ` -- currently ${count}` : ''}`}
                                >
                                  {ATTEMPT_TYPE_LABELS[type][0]}
                                  {count > 0 ? count : ''}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <select
                        className="pill-select"
                        value={order.delivery_status}
                        onChange={(e) => updateField(order.id, 'delivery_status', e.target.value)}
                        style={statusBadgeStyle(order.delivery_status)}
                      >
                        {deliveryOptions.map((step) => (
                          <option key={step} value={step}>{statusLabel(step)}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>৳{subtotal.toFixed(2)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        {/* Archive/Restore isn't offered here -- it lives on the order detail page only;
                            this dense row doesn't have room for it alongside everything else. */}
                        <Link href={`/orders/${order.id}`} className="icon-btn" title="Open order" aria-label="Open order">
                          <OpenIcon />
                        </Link>
                        {savingIds.has(order.id) ? <span title="Saving..." style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>⋯</span> : null}
                        {rowIssue ? (
                          <span title={rowIssue} style={{ fontSize: '0.8rem', color: rowErrors[order.id] ? '#c62828' : '#ef6c00', cursor: 'help' }}>
                            ⚠
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
      <div style={compact ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 'var(--space-3)' } : { display: 'grid', gap: '0.75rem' }}>
        {orders.map((order) => {
          const itemSummary = (order.order_items ?? []).map((item) => `${item.quantity} × ${item.sku || item.product_name}`).join(', ');
          const computedSubtotal = (order.order_items ?? []).reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
          const subtotal = order.total_amount ?? computedSubtotal;

          if (compact) {
            return (
              <div
                key={order.id}
                className="order-card"
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/orders/${order.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/orders/${order.id}`); }}
              >
                <div className="order-card-top">
                  <input
                    type="checkbox"
                    checked={selected.has(order.id)}
                    onChange={() => toggleOne(order.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="order-card-name">{order.customer_name}</span>
                </div>
                <a href={telHref(order.phone)} className="order-card-phone" onClick={(e) => e.stopPropagation()}>
                  {order.phone}
                </a>
                <div className="order-card-total">৳{subtotal.toFixed(2)}</div>
                <div className="order-card-items">{itemSummary || 'No items'}</div>
              </div>
            );
          }

          const rowClassName = order.urgency_type === 'urgent' || order.urgency_type === 'vu'
            ? 'order-row order-row--urgent'
            : order.urgency_type === 'hold'
              ? 'order-row order-row--hold'
              : 'order-row';
          const displayedUrgencyType = pendingUrgencyType[order.id] ?? order.urgency_type;
          const attemptsDisplay = formatAttemptsForDisplay(order.contact_attempts);
          const isTerminal = isTerminalConfirmationStatus(order.confirmation_status);

          return (
            <article key={order.id} className={rowClassName} style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '1.1rem 1.25rem', display: 'flex', gap: '0.75rem' }}>
              <input
                type="checkbox"
                checked={selected.has(order.id)}
                onChange={() => toggleOne(order.id)}
                style={{ marginTop: '0.3rem', flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.9rem', color: '#666' }}>{order.order_number ?? `Order #${order.id}`}</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{order.customer_name}</div>
                    <div style={{ marginTop: '0.3rem', fontSize: '0.9rem' }}>
                      <a href={telHref(order.phone)} style={{ fontWeight: 600 }}>{order.phone}</a>
                    </div>
                    <div style={{ color: '#666', marginTop: '0.15rem', fontSize: '0.9rem', maxWidth: '32rem', wordBreak: 'break-word' }}>{order.address}</div>
                    <div style={{ color: '#666', marginTop: '0.3rem' }}>{formatDhakaDateTime(order.created_at)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>Total: ৳{subtotal.toFixed(2)}</div>
                    <div style={{ marginTop: '0.35rem' }}>
                      <span style={{ ...statusBadgeStyle(order.urgency_type), borderRadius: '999px', padding: '0.25rem 0.6rem' }}>{urgencyLabel(order.urgency_type, order.urgency_target_date)}</span>
                    </div>
                  </div>
                </div>

                {order.visible_needs_review_reasons.length > 0 ? (
                  <div style={{ marginTop: '0.5rem', background: '#fff3e0', color: '#8a5300', borderRadius: '8px', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}>
                    <div>Needs review:</div>
                    {order.visible_needs_review_reasons.map((reason) => (
                      <div key={reason} style={{ marginTop: '0.15rem' }}>
                        {NEEDS_REVIEW_REASON_LABELS[reason] ?? reason}
                        <FlagActions
                          orderId={order.id}
                          flagType={reason}
                          sourceSystem="needs_review"
                          onActioned={() => handleFlagActioned(order.id, reason)}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}

                <div style={{ marginTop: '0.75rem', color: '#374151' }}>
                  <strong>Items:</strong> {itemSummary || 'No items'}
                </div>

                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {attemptsDisplay ? (
                    <span style={{ ...statusBadgeStyle('pending'), borderRadius: '999px', padding: '0.25rem 0.6rem', fontSize: '0.85rem', fontWeight: 600 }}>
                      {attemptsDisplay}
                    </span>
                  ) : null}
                  {!isTerminal ? ATTEMPT_TYPES.map((type) => {
                    const count = order.contact_attempts.find((a) => a.type === type)?.count ?? 0;
                    const max = ATTEMPT_MAX[type as keyof typeof ATTEMPT_MAX];
                    const capped = count >= max;
                    const loading = attemptLoggingIds.has(`${order.id}:${type}`);
                    return (
                      <button
                        key={type}
                        type="button"
                        className="btn-plain"
                        onClick={() => logAttempt(order.id, type)}
                        disabled={capped || loading}
                        title={capped ? `${ATTEMPT_TYPE_LABELS[type]} is capped at ${max} -- move to a terminal status to reset` : `Log a ${ATTEMPT_TYPE_LABELS[type]} attempt`}
                        style={{ fontSize: '0.8rem', opacity: capped ? 0.45 : 1 }}
                      >
                        {loading ? '...' : capped ? `${ATTEMPT_TYPE_LABELS[type]} (capped)` : `+ ${ATTEMPT_TYPE_LABELS[type]}`}
                      </button>
                    );
                  }) : null}
                </div>

                {/* bucket is always 'active' here -- History always takes the compact-card
                    branch above and returns before reaching this point. */}
                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                      Urgency
                      <select
                        value={displayedUrgencyType}
                        onChange={(e) => handleUrgencyTypeChange(order.id, e.target.value)}
                        style={{ ...statusBadgeStyle(displayedUrgencyType), border: 'none', borderRadius: '999px', padding: '0.25rem 0.6rem' }}
                      >
                        {urgencyTypeOptions.map((type) => (
                          <option key={type} value={type}>{urgencyTypeOptionLabel(type)}</option>
                        ))}
                      </select>
                    </label>
                    {displayedUrgencyType === 'vu' || displayedUrgencyType === 'd' ? (
                      <input
                        type="number"
                        min="1"
                        max="31"
                        placeholder="Day (1-31)"
                        key={`${order.id}-${order.urgency_target_date ?? 'unset'}`}
                        defaultValue={order.urgency_target_date ? new Date(order.urgency_target_date).getUTCDate() : ''}
                        onBlur={(e) => handleUrgencyDayCommit(order.id, displayedUrgencyType, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        style={{ width: '5.5rem', fontSize: '0.85rem' }}
                      />
                    ) : null}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                      Status
                      <select
                        value={order.confirmation_status}
                        onChange={(e) => updateField(order.id, 'confirmation_status', e.target.value)}
                        style={{ ...statusBadgeStyle(order.confirmation_status), border: 'none', borderRadius: '999px', padding: '0.25rem 0.6rem' }}
                      >
                        {confirmationStatusOptions.map((step) => (
                          <option key={step} value={step}>{statusLabel(step)}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                      Delivery
                      <select
                        value={order.delivery_status}
                        onChange={(e) => updateField(order.id, 'delivery_status', e.target.value)}
                        style={{ ...statusBadgeStyle(order.delivery_status), border: 'none', borderRadius: '999px', padding: '0.25rem 0.6rem' }}
                      >
                        {deliveryOptions.map((step) => (
                          <option key={step} value={step}>{statusLabel(step)}</option>
                        ))}
                      </select>
                    </label>
                    {savingIds.has(order.id) ? <span style={{ fontSize: '0.8rem', color: '#666' }}>Saving...</span> : null}
                    {rowErrors[order.id] ? <span style={{ fontSize: '0.8rem', color: '#c62828' }}>{rowErrors[order.id]}</span> : null}
                    {rowWarnings[order.id] ? <span style={{ fontSize: '0.8rem', color: '#ef6c00' }}>{rowWarnings[order.id]}</span> : null}
                  </div>

                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Link href={`/orders/${order.id}`} className="order-open-link" style={{ color: '#a83aa3', fontWeight: 600 }}>Open order →</Link>
                  <button
                    type="button"
                    className="btn-plain"
                    onClick={() => archiveOne(order.id, !order.archived_at)}
                    disabled={archivingIds.has(order.id)}
                  >
                    {archivingIds.has(order.id) ? 'Working...' : order.archived_at ? 'Restore' : 'Archive'}
                  </button>
                  {order.archived_at ? (
                    <span style={{ color: '#666', fontSize: '0.8rem' }}>Archived {formatDhakaDateTime(order.archived_at)}</span>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      )}

      <PaginationBar
        variant="full"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        visibleCount={orders.length}
        itemLabel={itemLabel}
        prevHref={prevHref}
        nextHref={nextHref}
        pageSizeHrefs={pageSizeHrefs}
      />
    </div>
  );
}
