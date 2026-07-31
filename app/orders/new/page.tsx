"use client";

import { FormEvent, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { defaultConfirmationStatus } from '@/lib/orderDefaults.mjs';

type OrderItemInput = {
  sku: string;
  product_name: string;
  quantity: string;
  unit_price: string;
};

type OrderFormState = {
  order_source: string;
  customer_name: string;
  phone: string;
  address: string;
  urgency_status: string;
  confirmation_status: string;
  delivery_status: string;
  special_instructions: string;
  cancel_return_reason: string;
  happiness_score: string;
  product_suggestions: string;
};

const initialState: OrderFormState = {
  order_source: 'shopify',
  customer_name: '',
  phone: '',
  address: '',
  urgency_status: 'normal',
  confirmation_status: defaultConfirmationStatus('shopify', new Date()),
  delivery_status: 'packaging',
  special_instructions: '',
  cancel_return_reason: '',
  happiness_score: '',
  product_suggestions: '',
};

const createEmptyItem = (): OrderItemInput => ({ sku: '', product_name: '', quantity: '1', unit_price: '0' });

export default function NewOrderPage() {
  const router = useRouter();
  const [form, setForm] = useState<OrderFormState>(initialState);
  const [items, setItems] = useState<OrderItemInput[]>([createEmptyItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  // once staff picks a confirmation_status manually, stop auto-recomputing it when order_source changes
  const [confirmationTouched, setConfirmationTouched] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    if (name === 'confirmation_status') {
      setConfirmationTouched(true);
      setForm((prev) => ({ ...prev, confirmation_status: value }));
      return;
    }

    if (name === 'order_source' && !confirmationTouched) {
      setForm((prev) => ({ ...prev, order_source: value, confirmation_status: defaultConfirmationStatus(value, new Date()) }));
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index: number, field: keyof OrderItemInput, value: string) => {
    setItems((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  };

  const addItem = () => {
    setItems((prev) => [...prev, createEmptyItem()]);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage('');

    const payload = {
      ...form,
      happiness_score: form.happiness_score === '' ? null : Number(form.happiness_score),
      items: items
        .filter((item) => item.sku.trim() || item.product_name.trim())
        .map((item) => ({
          sku: item.sku.trim(),
          product_name: item.product_name.trim(),
          quantity: Number(item.quantity || 1),
          unit_price: Number(item.unit_price || 0),
        })),
    };

    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    setSubmitting(false);

    if (!response.ok) {
      setMessage(result.error || 'Unable to create order');
      return;
    }

    setMessage('Order created');
    router.push('/orders');
  };

  return (
    <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>New order</h1>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
        <label>
          Order source
          <select name="order_source" value={form.order_source} onChange={handleChange}>
            <option value="shopify">Shopify</option>
            <option value="social">Social</option>
            <option value="otc">OTC</option>
          </select>
        </label>

        <label>
          Customer name
          <input name="customer_name" value={form.customer_name} onChange={handleChange} required />
        </label>

        <label>
          Phone
          <input name="phone" value={form.phone} onChange={handleChange} required />
        </label>

        <label>
          Address
          <textarea name="address" value={form.address} onChange={handleChange} required />
        </label>

        <div style={{ border: '1px solid #ddd', borderRadius: '12px', padding: '1rem', display: 'grid', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Line items</h2>
            <button type="button" className="btn-secondary" onClick={addItem}>Add another item</button>
          </div>

          {items.map((item, index) => (
            <div key={`${index}-${item.sku}`} style={{ display: 'grid', gap: '0.5rem', padding: '0.75rem', border: '1px solid #eee', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Item {index + 1}</strong>
                {items.length > 1 ? (
                  <button type="button" className="btn-plain" onClick={() => removeItem(index)}>Remove</button>
                ) : null}
              </div>

              <label>
                SKU
                <input value={item.sku} onChange={(e) => handleItemChange(index, 'sku', e.target.value)} required />
              </label>

              <label>
                Product name
                <input value={item.product_name} onChange={(e) => handleItemChange(index, 'product_name', e.target.value)} required />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label>
                  Quantity
                  <input type="number" min="1" value={item.quantity} onChange={(e) => handleItemChange(index, 'quantity', e.target.value)} required />
                </label>

                <label>
                  Unit price
                  <input type="number" step="0.01" min="0" value={item.unit_price} onChange={(e) => handleItemChange(index, 'unit_price', e.target.value)} required />
                </label>
              </div>
            </div>
          ))}
        </div>

        <label>
          Urgency status
          <select name="urgency_status" value={form.urgency_status} onChange={handleChange}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
            <option value="hold">Hold</option>
          </select>
        </label>

        <label>
          Confirmation status
          <select name="confirmation_status" value={form.confirmation_status} onChange={handleChange}>
            <option value="pending">Pending</option>
            <option value="x1">X1</option>
            <option value="x2">X2</option>
            <option value="x3">X3</option>
            <option value="confirmed_m">Confirmed (M)</option>
            <option value="confirmed_wa">Confirmed (Wa)</option>
            <option value="confirmed_c">Confirmed (C)</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <span style={{ display: 'block', fontSize: '0.8rem', color: '#666', marginTop: '0.15rem' }}>
            Auto-filled based on order source ({defaultConfirmationStatus(form.order_source, new Date()) === 'confirmed_m' ? 'manual/walk-in channel, no call needed' : 'needs a confirmation call'}) — change it if this order is different.
          </span>
        </label>

        <label>
          Delivery status
          <select name="delivery_status" value={form.delivery_status} onChange={handleChange}>
            <option value="packaging">Packaging</option>
            <option value="sent_to_courier">Sent to courier</option>
            <option value="delivered">Delivered</option>
            <option value="returned">Returned</option>
          </select>
        </label>

        <label>
          Special instructions
          <textarea name="special_instructions" value={form.special_instructions} onChange={handleChange} />
        </label>

        <label>
          Cancel/return reason
          <textarea name="cancel_return_reason" value={form.cancel_return_reason} onChange={handleChange} />
        </label>

        <label>
          Happiness score
          <input type="number" step="0.1" name="happiness_score" value={form.happiness_score} onChange={handleChange} />
        </label>

        <label>
          Product suggestions
          <textarea name="product_suggestions" value={form.product_suggestions} onChange={handleChange} />
        </label>

        <button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Create order'}</button>
        {message ? <p>{message}</p> : null}
      </form>
    </main>
  );
}
