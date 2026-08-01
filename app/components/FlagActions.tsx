"use client";

import { useState } from 'react';

type FlagActionsProps = {
  orderId: number;
  flagType: string;
  sourceSystem: 'needs_review' | 'attention_needed';
  onActioned?: () => void;
};

export default function FlagActions({ orderId, flagType, sourceSystem, onActioned }: FlagActionsProps) {
  const [showIgnoreInput, setShowIgnoreInput] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (status: 'resolved' | 'ignored', note: string) => {
    setSubmitting(true);
    setError('');

    const response = await fetch('/api/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, flag_type: flagType, source_system: sourceSystem, status, note: note || undefined }),
    });

    const result = await response.json();
    setSubmitting(false);

    if (!response.ok || !result.ok) {
      setError(result.error || 'Unable to save');
      return;
    }

    setShowIgnoreInput(false);
    setReason('');
    onActioned?.();
  };

  if (showIgnoreInput) {
    return (
      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.25rem' }}>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why isn't this a real issue?"
          style={{ padding: '0.25rem 0.4rem', fontSize: '0.8rem', minWidth: '14rem' }}
          autoFocus
        />
        <button
          type="button"
          disabled={submitting || !reason.trim()}
          onClick={() => submit('ignored', reason.trim())}
          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
        >
          {submitting ? 'Saving…' : 'Confirm ignore'}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            setShowIgnoreInput(false);
            setReason('');
          }}
          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
        >
          Cancel
        </button>
        {error && <span style={{ color: '#c62828', fontSize: '0.8rem' }}>{error}</span>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.25rem' }}>
      <button type="button" disabled={submitting} onClick={() => submit('resolved', '')} style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}>
        Mark Resolved
      </button>
      <button type="button" disabled={submitting} onClick={() => setShowIgnoreInput(true)} style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}>
        Ignore
      </button>
      {error && <span style={{ color: '#c62828', fontSize: '0.8rem' }}>{error}</span>}
    </div>
  );
}
