"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { statusBadgeStyle, statusLabel, confirmationSteps, deliveryOptions, urgencyTypeOptions, urgencyTypeOptionLabel, urgencyLabel, telHref, CALL_PENDING_STAGES } from '@/lib/theme';

type OrderItem = {
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
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
  order_items: OrderItem[];
};

export default function OrdersList({ orders: initialOrders, view }: { orders: OrderRow[]; view: string }) {
  const [orders, setOrders] = useState(initialOrders);

  // Switching views (e.g. Call Pending -> All) via the nav pills is a client-side
  // navigation on the same route, so this component isn't remounted -- without this,
  // useState(initialOrders) would keep showing whatever filtered list was left over
  // from the previous view instead of the newly fetched orders for the new one.
  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);
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

  const updateField = async (orderId: number, field: 'confirmation_status' | 'delivery_status', value: string) => {
    const previous = orders.find((o) => o.id === orderId)?.[field];
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, [field]: value } : o)));
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
        // Call Pending only ever shows pending/x1/x2/x3 -- once a row is marked confirmed or
        // cancelled it no longer belongs here, so drop it from view immediately rather than
        // leaving it visible (with an updated badge) until the next full page load
        if (field === 'confirmation_status' && view === 'call-pending' && !CALL_PENDING_STAGES.includes(value)) {
          setOrders((prev) => prev.filter((o) => o.id !== orderId));
          setSelected((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
        }
      }
    } catch {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, [field]: previous ?? o[field] } : o)));
      setRowErrors((prev) => ({ ...prev, [orderId]: 'Unable to save' }));
    } finally {
      setSavingIds((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Select all
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

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {orders.map((order) => {
          const itemSummary = (order.order_items ?? []).map((item) => `${item.quantity} × ${item.sku || item.product_name}`).join(', ');
          const computedSubtotal = (order.order_items ?? []).reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
          const subtotal = order.total_amount ?? computedSubtotal;
          const rowClassName = order.urgency_type === 'urgent' || order.urgency_type === 'vu'
            ? 'order-row order-row--urgent'
            : order.urgency_type === 'hold'
              ? 'order-row order-row--hold'
              : 'order-row';
          const displayedUrgencyType = pendingUrgencyType[order.id] ?? order.urgency_type;

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
                    <div style={{ color: '#666', marginTop: '0.3rem' }}>{new Date(order.created_at).toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>Total: ৳{subtotal.toFixed(2)}</div>
                    <div style={{ marginTop: '0.35rem' }}>
                      <span style={{ ...statusBadgeStyle(order.urgency_type), borderRadius: '999px', padding: '0.25rem 0.6rem' }}>{urgencyLabel(order.urgency_type, order.urgency_target_date)}</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '0.75rem', color: '#374151' }}>
                  <strong>Items:</strong> {itemSummary || 'No items'}
                </div>

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
                    Confirmation
                    <select
                      value={order.confirmation_status}
                      onChange={(e) => updateField(order.id, 'confirmation_status', e.target.value)}
                      style={{ ...statusBadgeStyle(order.confirmation_status), border: 'none', borderRadius: '999px', padding: '0.25rem 0.6rem' }}
                    >
                      {confirmationSteps.map((step) => (
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
                  <Link href={`/orders/${order.id}`} style={{ color: '#a83aa3', fontWeight: 600 }}>Open order →</Link>
                  <button
                    type="button"
                    className="btn-plain"
                    onClick={() => archiveOne(order.id, !order.archived_at)}
                    disabled={archivingIds.has(order.id)}
                  >
                    {archivingIds.has(order.id) ? 'Working...' : order.archived_at ? 'Restore' : 'Archive'}
                  </button>
                  {order.archived_at ? (
                    <span style={{ color: '#666', fontSize: '0.8rem' }}>Archived {new Date(order.archived_at).toLocaleString()}</span>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
