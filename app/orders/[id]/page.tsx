"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type OrderItem = {
  id?: number;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
};

type Order = {
  id: number;
  created_at: string;
  order_source: string;
  customer_name: string;
  phone: string;
  address: string;
  urgency_status: string;
  confirmation_status: string;
  delivery_status: string;
  special_instructions: string | null;
  cancel_return_reason: string | null;
  happiness_score: number | null;
  product_suggestions: string | null;
  order_items?: OrderItem[];
};

const confirmationSteps = ['pending', 'x1', 'x2', 'x3', 'confirmed', 'cancelled'];
const urgencyOptions = ['normal', 'urgent', 'hold'];
const deliveryOptions = ['packaging', 'sent_to_courier', 'delivered', 'returned'];

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [order, setOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const loadOrder = async () => {
      const response = await fetch(`/api/orders?id=${id}`);
      const result = await response.json();
      if (result?.data) {
        setOrder(result.data);
      }
    };

    if (id) {
      loadOrder();
    }
  }, [id]);

  const updateField = async (field: keyof Order, value: string | number | null) => {
    if (!order) return;

    const nextOrder = { ...order, [field]: value };
    setOrder(nextOrder);
    setSaving(true);
    setMessage('');

    const response = await fetch(`/api/orders?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, [field]: value }),
    });

    const result = await response.json();
    setSaving(false);

    if (!response.ok) {
      setMessage(result.error || 'Unable to save');
      return;
    }

    setMessage('Saved — returning to orders…');
    window.setTimeout(() => {
      router.replace(`/orders?updated=${Date.now()}`);
    }, 250);
  };

  const bumpConfirmation = async () => {
    if (!order) return;
    const index = confirmationSteps.indexOf(order.confirmation_status);
    const next = confirmationSteps[(index + 1) % confirmationSteps.length];
    await updateField('confirmation_status', next);
  };

  if (!order) {
    return <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>Loading...</main>;
  }

  const subtotal = (order.order_items ?? []).reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

  return (
    <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <button onClick={() => router.push(`/orders?updated=${Date.now()}`)} style={{ marginBottom: '1rem' }}>Back to orders</button>
      <h1>{order.customer_name}</h1>
      <p>Created: {new Date(order.created_at).toLocaleString()}</p>
      <p>Phone: {order.phone}</p>
      <p>Address: {order.address}</p>

      <div style={{ border: '1px solid #ddd', borderRadius: '12px', padding: '1rem', marginTop: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Items</h2>
        {(order.order_items ?? []).map((item, index) => (
          <div key={`${item.sku}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0', borderBottom: '1px solid #f0f0f0' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{item.product_name}</div>
              <div style={{ color: '#666' }}>SKU: {item.sku}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div>{item.quantity} × ${item.unit_price.toFixed(2)}</div>
              <div style={{ color: '#666' }}>Line total: ${(item.quantity * item.unit_price).toFixed(2)}</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop: '0.75rem', fontWeight: 700 }}>Subtotal: ${subtotal.toFixed(2)}</div>
      </div>

      <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
        <div>
          <label>Confirmation status</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            <select
              value={order.confirmation_status}
              onChange={(e) => updateField('confirmation_status', e.target.value)}
            >
              {confirmationSteps.map((step) => (
                <option key={step} value={step}>{step}</option>
              ))}
            </select>
            <button type="button" onClick={bumpConfirmation}>Bump</button>
          </div>
        </div>

        <div>
          <label>Delivery status</label>
          <select
            value={order.delivery_status}
            onChange={(e) => updateField('delivery_status', e.target.value)}
            style={{ display: 'block', marginTop: '0.25rem' }}
          >
            {deliveryOptions.map((step) => (
              <option key={step} value={step}>{step}</option>
            ))}
          </select>
        </div>

        <div>
          <label>Urgency status</label>
          <select
            value={order.urgency_status}
            onChange={(e) => updateField('urgency_status', e.target.value)}
            style={{ display: 'block', marginTop: '0.25rem' }}
          >
            {urgencyOptions.map((step) => (
              <option key={step} value={step}>{step}</option>
            ))}
          </select>
        </div>

        <div>
          <label>Special instructions</label>
          <textarea
            value={order.special_instructions ?? ''}
            onChange={(e) => updateField('special_instructions', e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </div>

        <div>
          <label>Cancel/return reason</label>
          <textarea
            value={order.cancel_return_reason ?? ''}
            onChange={(e) => updateField('cancel_return_reason', e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </div>

        <div>
          <label>Happiness score</label>
          <input
            type="number"
            step="0.1"
            value={order.happiness_score ?? ''}
            onChange={(e) => updateField('happiness_score', e.target.value === '' ? null : Number(e.target.value))}
            style={{ display: 'block', marginTop: '0.25rem' }}
          />
        </div>

        <div>
          <label>Product suggestions</label>
          <textarea
            value={order.product_suggestions ?? ''}
            onChange={(e) => updateField('product_suggestions', e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </div>
      </div>

      {saving ? <p>Saving...</p> : null}
      {message ? <p>{message}</p> : null}
    </main>
  );
}
