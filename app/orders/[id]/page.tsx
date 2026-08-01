"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { statusBadgeStyle, statusLabel, confirmationStatusOptions, deliveryOptions, urgencyTypeOptions, urgencyTypeOptionLabel, urgencyLabel, telHref } from '@/lib/theme';
import { NEEDS_REVIEW_REASON_LABELS, countWords, FEEDBACK_MAX_WORDS } from '@/lib/orderValidation.mjs';
import { ATTEMPT_TYPES, ATTEMPT_MAX, ATTEMPT_TYPE_LABELS, isTerminalConfirmationStatus, formatAttemptsForDisplay } from '@/lib/contactAttempts.mjs';
import FlagActions from '@/app/components/FlagActions';
import HappinessScorePicker from '@/app/components/HappinessScorePicker';

type OrderItem = {
  id?: number;
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

type HistoryEntry = {
  id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  actor: string | null;
  changed_at: string;
};

type Order = {
  id: number;
  order_number: string | null;
  created_at: string;
  order_source: string;
  customer_name: string;
  phone: string;
  address: string;
  urgency_type: string;
  urgency_target_date: string | null;
  confirmation_status: string;
  delivery_status: string;
  special_instructions: string | null;
  cancel_return_reason: string | null;
  happiness_score: number | null;
  product_suggestions: string | null;
  feedback: string | null;
  total_amount: number | null;
  archived_at: string | null;
  needs_review: boolean;
  needs_review_reasons: string[] | null;
  visible_needs_review_reasons?: string[];
  order_items?: OrderItem[];
  contact_attempts?: ContactAttempt[];
};

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [order, setOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // set only while a vu/d type is picked but no day has been committed yet -- keeps the
  // select showing the just-picked type even though nothing's saved
  const [pendingUrgencyType, setPendingUrgencyType] = useState<string | null>(null);

  // Free-text fields use an explicit Save button instead of autosaving on every keystroke (that
  // was writing one order_history row per keystroke) -- these hold the in-progress, not-yet-saved
  // draft. Seeded once when the order first loads (see the effect below), then independently
  // user-controlled; a successful save updates `order` to match what's already showing here.
  const [specialInstructionsDraft, setSpecialInstructionsDraft] = useState('');
  const [cancelReturnReasonDraft, setCancelReturnReasonDraft] = useState('');
  const [happinessScoreDraft, setHappinessScoreDraft] = useState<number | null>(null);
  const [productSuggestionsDraft, setProductSuggestionsDraft] = useState('');
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [draftsReady, setDraftsReady] = useState(false);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/orders/history?id=${id}`);
      const result = await response.json();
      if (result?.data) {
        setHistory(result.data);
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadOrder = async () => {
    const response = await fetch(`/api/orders?id=${id}`);
    const result = await response.json();
    if (result?.data) {
      setOrder(result.data);
    }
  };

  useEffect(() => {
    if (id) {
      loadOrder();
      loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Seed the draft fields once, the first time the order loads -- keyed on order.id (which never
  // changes on this page) rather than `order` itself, so a later save's setOrder(...) doesn't
  // stomp on whatever the user is still typing in an unrelated field.
  useEffect(() => {
    if (order && !draftsReady) {
      setSpecialInstructionsDraft(order.special_instructions ?? '');
      setCancelReturnReasonDraft(order.cancel_return_reason ?? '');
      setHappinessScoreDraft(order.happiness_score ?? null);
      setProductSuggestionsDraft(order.product_suggestions ?? '');
      setFeedbackDraft(order.feedback ?? '');
      setDraftsReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, draftsReady]);

  const updateField = async (field: keyof Order, value: string | number | null) => {
    if (!order) return;

    // moving to a terminal confirmation status wipes contact_attempts server-side -- mirror
    // that locally so the attempt badges clear immediately
    const wipesAttempts = field === 'confirmation_status' && typeof value === 'string' && isTerminalConfirmationStatus(value);
    const nextOrder = { ...order, [field]: value, ...(wipesAttempts ? { contact_attempts: [] } : {}) };
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

    setMessage(result.sheetSyncWarning || 'Saved');
    loadHistory();
  };

  // Explicit-Save counterpart to updateField -- takes one or more fields at once (the Feedback
  // box saves happiness_score/product_suggestions/feedback together as one PATCH) and only ever
  // runs when a Save button is clicked, never on a field's own onChange.
  const saveFields = async (fields: Partial<Pick<Order, 'special_instructions' | 'cancel_return_reason' | 'happiness_score' | 'product_suggestions' | 'feedback'>>) => {
    if (!order) return;
    setSaving(true);
    setMessage('');

    const response = await fetch(`/api/orders?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    const result = await response.json();
    setSaving(false);

    if (!response.ok) {
      setMessage(result.error || 'Unable to save');
      return;
    }

    setOrder((prev) => (prev ? { ...prev, ...fields } : prev));
    setMessage(result.sheetSyncWarning || 'Saved');
    loadHistory();
  };

  const saveUrgency = async (type: string, day?: number) => {
    if (!order) return;
    setSaving(true);
    setMessage('');

    const body: Record<string, unknown> = { id, urgency_type: type };
    if (day !== undefined) body.urgency_target_day = day;

    const response = await fetch(`/api/orders?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    setSaving(false);

    if (!response.ok) {
      setMessage(result.error || 'Unable to save');
      return;
    }

    setOrder((prev) => (prev ? { ...prev, urgency_type: result.data.urgency_type, urgency_target_date: result.data.urgency_target_date } : prev));
    setPendingUrgencyType(null);
    setMessage(result.sheetSyncWarning || 'Saved');
    loadHistory();
  };

  const handleUrgencyTypeChange = async (newType: string) => {
    if (!order) return;
    setPendingUrgencyType(newType);
    setMessage('');

    if (newType === 'vu' || newType === 'd') {
      if (order.urgency_target_date) {
        // carrying over an already-known day (e.g. switching vu <-> d) can save immediately
        await saveUrgency(newType, new Date(order.urgency_target_date).getUTCDate());
      }
      // otherwise wait for the day-of-month input below
      return;
    }

    await saveUrgency(newType);
  };

  const handleUrgencyDayCommit = async (rawDay: string) => {
    const type = pendingUrgencyType ?? order?.urgency_type;
    if (!type || (type !== 'vu' && type !== 'd')) return;
    if (!rawDay.trim()) return;
    const day = Number(rawDay);
    if (!Number.isFinite(day)) return;
    await saveUrgency(type, day);
  };

  const STATUS_FIELDS = new Set(['confirmation_status', 'delivery_status', 'urgency_type']);
  const SOURCE_LABELS: Record<string, string> = { moderator: 'Staff edit', sheet_sync: 'Sheet sync', csv_import: 'CSV import', system: 'System' };
  const FIELD_LABELS: Record<string, string> = {
    order_created: 'Order created',
    order_items: 'Items',
    removed_from_sheet_at: 'Removed from sheet',
    urgency_target_date: 'Urgency target date',
  };

  const formatHistoryField = (field: string) => FIELD_LABELS[field] ?? statusLabel(field);

  const formatHistoryValue = (field: string, value: string | null) => {
    if (value === null || value === '') return '(empty)';
    if (STATUS_FIELDS.has(field)) return statusLabel(value);
    if (field === 'changed_at' || field === 'removed_from_sheet_at' || field === 'created_at') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
    }
    return value;
  };

  const toggleArchived = async () => {
    if (!order) return;
    const archiving = !order.archived_at;
    const confirmed = window.confirm(
      archiving
        ? 'Archive this order? It will be hidden from normal views but can be restored anytime.'
        : 'Restore this order back into normal views?',
    );
    if (!confirmed) return;
    await updateField('archived_at', archiving ? new Date().toISOString() : null);
  };

  const [attemptLogging, setAttemptLogging] = useState<string | null>(null);

  const logAttempt = async (type: string) => {
    if (!order) return;
    setAttemptLogging(type);
    setMessage('');

    try {
      const response = await fetch('/api/orders/attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, type }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        setMessage(result.error || 'Unable to log attempt');
        return;
      }

      setOrder((prev) => (prev ? { ...prev, contact_attempts: result.data.attempts } : prev));
      setMessage(result.sheetSyncWarning || 'Saved');
      loadHistory();
    } finally {
      setAttemptLogging(null);
    }
  };

  if (!order) {
    return <div style={{ maxWidth: 960, margin: '0 auto' }}>Loading...</div>;
  }

  const computedSubtotal = (order.order_items ?? []).reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const subtotal = order.total_amount ?? computedSubtotal;

  const feedbackWordCount = countWords(feedbackDraft);
  const feedbackDirty =
    happinessScoreDraft !== (order.happiness_score ?? null) ||
    productSuggestionsDraft !== (order.product_suggestions ?? '') ||
    feedbackDraft !== (order.feedback ?? '');

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <button type="button" className="nav-pill" onClick={() => router.push(`/orders?updated=${Date.now()}`)} style={{ marginBottom: 'var(--space-2)' }}>← Back to orders</button>
          <div style={{ fontSize: '0.9rem', color: '#666' }}>{order.order_number ?? `Order #${order.id}`}</div>
          <h1 style={{ marginBottom: 'var(--space-2)' }}>{order.customer_name}</h1>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ ...statusBadgeStyle(order.urgency_type), borderRadius: '999px', padding: '0.25rem 0.6rem', fontSize: '0.85rem' }}>{urgencyLabel(order.urgency_type, order.urgency_target_date)}</span>
            <span style={{ ...statusBadgeStyle(order.confirmation_status), borderRadius: '999px', padding: '0.25rem 0.6rem', fontSize: '0.85rem' }}>{statusLabel(order.confirmation_status)}</span>
            <span style={{ ...statusBadgeStyle(order.delivery_status), borderRadius: '999px', padding: '0.25rem 0.6rem', fontSize: '0.85rem' }}>{statusLabel(order.delivery_status)}</span>
            {order.archived_at ? (
              <span style={{ background: '#f0f0f0', color: '#616161', borderRadius: '999px', padding: '0.25rem 0.6rem', fontSize: '0.85rem' }}>
                Archived {new Date(order.archived_at).toLocaleDateString()}
              </span>
            ) : null}
          </div>
        </div>
        <button type="button" className="btn-plain" onClick={toggleArchived} disabled={saving}>
          {order.archived_at ? 'Restore order' : 'Archive order'}
        </button>
      </div>

      <div className="card">
        <p style={{ margin: '0 0 0.4rem' }}>Created: {new Date(order.created_at).toLocaleString()}</p>
        <p style={{ margin: '0 0 0.4rem' }}>Phone: <a href={telHref(order.phone)}>{order.phone}</a></p>
        <p style={{ margin: 0 }}>Address: {order.address}</p>

        {(order.visible_needs_review_reasons ?? []).length > 0 ? (
          <div style={{ background: '#fff3e0', color: '#8a5300', borderRadius: '8px', padding: '0.6rem 0.85rem', marginTop: 'var(--space-3)' }}>
            <strong>Needs review:</strong>
            {(order.visible_needs_review_reasons ?? []).map((reason) => (
              <div key={reason} style={{ marginTop: '0.35rem' }}>
                {NEEDS_REVIEW_REASON_LABELS[reason] ?? reason}
                <FlagActions orderId={order.id} flagType={reason} sourceSystem="needs_review" onActioned={loadOrder} />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Items</h2>
        {(order.order_items ?? []).map((item, index) => (
          <div key={`${item.sku}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0', borderBottom: '1px solid var(--card-border)' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{item.product_name}</div>
              <div style={{ color: '#666' }}>SKU: {item.sku}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div>{item.quantity} × ৳{item.unit_price.toFixed(2)}</div>
              <div style={{ color: '#666' }}>Line total: ৳{(item.quantity * item.unit_price).toFixed(2)}</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop: '0.75rem', fontWeight: 700 }}>Subtotal: ৳{subtotal.toFixed(2)}</div>
      </div>

      <div className="card" style={{ display: 'grid', gap: '0.75rem' }}>
        <div>
          <label>Contact attempts</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {formatAttemptsForDisplay(order.contact_attempts ?? []) ? (
              <span style={{ ...statusBadgeStyle('pending'), borderRadius: '999px', padding: '0.25rem 0.6rem', fontSize: '0.9rem', fontWeight: 600 }}>
                {formatAttemptsForDisplay(order.contact_attempts ?? [])}
              </span>
            ) : null}
            {!isTerminalConfirmationStatus(order.confirmation_status) ? ATTEMPT_TYPES.map((type) => {
              const count = (order.contact_attempts ?? []).find((a) => a.type === type)?.count ?? 0;
              const max = ATTEMPT_MAX[type as keyof typeof ATTEMPT_MAX];
              const capped = count >= max;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => logAttempt(type)}
                  disabled={capped || attemptLogging === type}
                  title={capped ? `${ATTEMPT_TYPE_LABELS[type]} is capped at ${max} -- move to a terminal status to reset` : `Log a ${ATTEMPT_TYPE_LABELS[type]} attempt`}
                  style={{ opacity: capped ? 0.45 : 1 }}
                >
                  {attemptLogging === type ? '...' : capped ? `${ATTEMPT_TYPE_LABELS[type]} (capped)` : `+ ${ATTEMPT_TYPE_LABELS[type]}`}
                </button>
              );
            }) : (
              <span style={{ color: '#666', fontSize: '0.85rem' }}>Move status back to Pending to log attempts.</span>
            )}
          </div>
        </div>

        <div>
          <label>Confirmation status</label>
          <select
            value={order.confirmation_status}
            onChange={(e) => updateField('confirmation_status', e.target.value)}
            style={{ display: 'block', marginTop: '0.25rem' }}
          >
            {confirmationStatusOptions.map((step) => (
              <option key={step} value={step}>{statusLabel(step)}</option>
            ))}
          </select>
        </div>

        <div>
          <label>Delivery status</label>
          <select
            value={order.delivery_status}
            onChange={(e) => updateField('delivery_status', e.target.value)}
            style={{ display: 'block', marginTop: '0.25rem' }}
          >
            {deliveryOptions.map((step) => (
              <option key={step} value={step}>{statusLabel(step)}</option>
            ))}
          </select>
        </div>

        <div>
          <label>Urgency</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', alignItems: 'center' }}>
            <select
              value={pendingUrgencyType ?? order.urgency_type}
              onChange={(e) => handleUrgencyTypeChange(e.target.value)}
            >
              {urgencyTypeOptions.map((type) => (
                <option key={type} value={type}>{urgencyTypeOptionLabel(type)}</option>
              ))}
            </select>
            {(pendingUrgencyType ?? order.urgency_type) === 'vu' || (pendingUrgencyType ?? order.urgency_type) === 'd' ? (
              <input
                type="number"
                min="1"
                max="31"
                placeholder="Day (1-31)"
                key={order.urgency_target_date ?? 'unset'}
                defaultValue={order.urgency_target_date ? new Date(order.urgency_target_date).getUTCDate() : ''}
                onBlur={(e) => handleUrgencyDayCommit(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                style={{ width: '5.5rem' }}
              />
            ) : null}
          </div>
        </div>

        <div>
          <label>Special instructions</label>
          <textarea
            value={specialInstructionsDraft}
            onChange={(e) => setSpecialInstructionsDraft(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
          <button
            type="button"
            style={{ marginTop: '0.4rem' }}
            disabled={saving || specialInstructionsDraft === (order.special_instructions ?? '')}
            onClick={() => saveFields({ special_instructions: specialInstructionsDraft || null })}
          >
            Save
          </button>
        </div>

        <div>
          <label>Cancel/return reason</label>
          <textarea
            value={cancelReturnReasonDraft}
            onChange={(e) => setCancelReturnReasonDraft(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
          <button
            type="button"
            style={{ marginTop: '0.4rem' }}
            disabled={saving || cancelReturnReasonDraft === (order.cancel_return_reason ?? '')}
            onClick={() => saveFields({ cancel_return_reason: cancelReturnReasonDraft || null })}
          >
            Save
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Feedback</h2>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div>
            <label>Happiness score</label>
            <HappinessScorePicker value={happinessScoreDraft} onChange={setHappinessScoreDraft} />
          </div>

          <div>
            <label>Product suggestions</label>
            <textarea
              value={productSuggestionsDraft}
              onChange={(e) => setProductSuggestionsDraft(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
            />
          </div>

          <div>
            <label>Feedback</label>
            <textarea
              value={feedbackDraft}
              onChange={(e) => setFeedbackDraft(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
            />
            <div style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: feedbackWordCount > FEEDBACK_MAX_WORDS ? '#c62828' : 'var(--text-muted)' }}>
              {feedbackWordCount}/{FEEDBACK_MAX_WORDS} words{feedbackWordCount > FEEDBACK_MAX_WORDS ? ' — over the limit, trim it before saving' : ''}
            </div>
          </div>

          <div>
            <button
              type="button"
              disabled={saving || feedbackWordCount > FEEDBACK_MAX_WORDS || !feedbackDirty}
              onClick={() =>
                saveFields({
                  happiness_score: happinessScoreDraft,
                  product_suggestions: productSuggestionsDraft || null,
                  feedback: feedbackDraft || null,
                })
              }
            >
              Save feedback
            </button>
          </div>
        </div>
      </div>

      {saving || message ? (
        <div style={{ margin: 'var(--space-2) 0 0', fontSize: '0.85rem', color: saving ? 'var(--text-muted)' : 'var(--text)' }}>
          {saving ? 'Saving...' : message}
        </div>
      ) : null}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>History</h2>
        {historyLoading ? (
          <p style={{ color: '#666' }}>Loading history...</p>
        ) : history.length === 0 ? (
          <p style={{ color: '#666' }}>No changes recorded yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {history.map((entry) => (
              <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0', borderBottom: '1px solid var(--card-border)', fontSize: '0.9rem' }}>
                <div>
                  <strong>{formatHistoryField(entry.field)}</strong>
                  {entry.field === 'order_created' || entry.field === 'order_items' || entry.field === 'removed_from_sheet_at' ? (
                    <span>: {formatHistoryValue(entry.field, entry.new_value)}</span>
                  ) : (
                    <span>
                      {' '}changed from <em>{formatHistoryValue(entry.field, entry.old_value)}</em> to{' '}
                      <em>{formatHistoryValue(entry.field, entry.new_value)}</em>
                    </span>
                  )}
                  <div style={{ color: '#666', fontSize: '0.8rem', marginTop: '0.15rem' }}>
                    {SOURCE_LABELS[entry.source] ?? entry.source}
                    {entry.actor ? ` · ${entry.actor}` : ''}
                  </div>
                </div>
                <div style={{ color: '#666', whiteSpace: 'nowrap' }}>{new Date(entry.changed_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
