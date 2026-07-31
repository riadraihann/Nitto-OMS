"use client";

import Link from 'next/link';
import { useState } from 'react';
import { statusBadgeStyle, statusLabel } from '@/lib/theme';

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
  urgency_status: string;
  confirmation_status: string;
  delivery_status: string;
  created_at: string;
  total_amount: number | null;
  order_items: OrderItem[];
};

export default function OrdersList({ orders }: { orders: OrderRow[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

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
      </div>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {orders.map((order) => {
          const itemSummary = (order.order_items ?? []).map((item) => `${item.quantity} × ${item.sku || item.product_name}`).join(', ');
          const computedSubtotal = (order.order_items ?? []).reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
          const subtotal = order.total_amount ?? computedSubtotal;
          const rowStyle = order.urgency_status === 'urgent'
            ? { backgroundColor: '#ffe6e6' }
            : order.urgency_status === 'hold'
              ? { backgroundColor: '#fff7d6' }
              : { backgroundColor: '#fff' };

          return (
            <article key={order.id} style={{ ...rowStyle, border: '1px solid #e5e7eb', borderRadius: '12px', padding: '1rem', display: 'flex', gap: '0.75rem' }}>
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
                    <div style={{ color: '#666', marginTop: '0.2rem' }}>{new Date(order.created_at).toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>Total: ৳{subtotal.toFixed(2)}</div>
                    <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span style={{ ...statusBadgeStyle(order.urgency_status), borderRadius: '999px', padding: '0.25rem 0.6rem' }}>{statusLabel(order.urgency_status)}</span>
                      <span style={{ ...statusBadgeStyle(order.confirmation_status), borderRadius: '999px', padding: '0.25rem 0.6rem' }}>{statusLabel(order.confirmation_status)}</span>
                      <span style={{ ...statusBadgeStyle(order.delivery_status), borderRadius: '999px', padding: '0.25rem 0.6rem' }}>{statusLabel(order.delivery_status)}</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '0.75rem', color: '#374151' }}>
                  <strong>Items:</strong> {itemSummary || 'No items'}
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                  <Link href={`/orders/${order.id}`} style={{ color: '#a83aa3', fontWeight: 600 }}>Open order →</Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
