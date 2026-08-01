"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { statusBadgeStyle, statusLabel } from '@/lib/theme';

type SearchResult = {
  id: number;
  order_number: string | null;
  customer_name: string;
  phone: string;
  confirmation_status: string;
  delivery_status: string;
  match_field: 'order_number' | 'customer_name' | 'phone' | 'address' | 'special_instructions' | null;
  snippet: string | null;
};

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

const MATCH_FIELD_LABELS: Record<string, string> = {
  address: 'Matched in address',
  special_instructions: 'Matched in special instructions',
};

export default function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetch(`/api/search/orders?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((result) => {
          if (!result?.ok) {
            setError(result?.error || 'Search failed');
            setResults([]);
            return;
          }
          setError('');
          setResults(result.data);
          setActiveIndex(-1);
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return;
          setError('Search failed');
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const goToOrder = (id: number) => {
    setOpen(false);
    setQuery('');
    setResults([]);
    router.push(`/orders/${id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[activeIndex] ?? results[0];
      if (target) goToOrder(target.id);
    }
  };

  const trimmed = query.trim();
  const showDropdown = open && trimmed.length >= MIN_QUERY_LENGTH;

  return (
    <div className="global-search" ref={wrapperRef}>
      <div className="global-search-input-wrap">
        <svg className="global-search-icon" width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={query}
          placeholder="Search orders by number, name, phone, address…"
          className="global-search-input"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          aria-label="Search orders"
          aria-expanded={showDropdown}
          role="combobox"
          aria-controls="global-search-results"
          aria-autocomplete="list"
        />
        {loading ? <span className="global-search-spinner" aria-hidden="true" /> : null}
      </div>

      {showDropdown ? (
        <div className="global-search-dropdown" id="global-search-results" role="listbox">
          {error ? (
            <div className="global-search-empty">{error}</div>
          ) : loading && results.length === 0 ? (
            <div className="global-search-empty">Searching…</div>
          ) : results.length === 0 ? (
            <div className="global-search-empty">No orders match &ldquo;{trimmed}&rdquo;.</div>
          ) : (
            results.map((result, index) => (
              <button
                type="button"
                key={result.id}
                role="option"
                aria-selected={index === activeIndex}
                className={`global-search-result${index === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => goToOrder(result.id)}
              >
                <div className="global-search-result-main">
                  <span className="global-search-result-order">{result.order_number ?? `Order #${result.id}`}</span>
                  <span className="global-search-result-name">{result.customer_name}</span>
                </div>
                <div className="global-search-result-sub">
                  <span>{result.phone}</span>
                  <span className="status-pill-static" style={statusBadgeStyle(result.confirmation_status)}>{statusLabel(result.confirmation_status)}</span>
                  <span className="status-pill-static" style={statusBadgeStyle(result.delivery_status)}>{statusLabel(result.delivery_status)}</span>
                </div>
                {result.match_field && MATCH_FIELD_LABELS[result.match_field] ? (
                  <div className="global-search-result-match">
                    {MATCH_FIELD_LABELS[result.match_field]}{result.snippet ? `: "${result.snippet}"` : ''}
                  </div>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
