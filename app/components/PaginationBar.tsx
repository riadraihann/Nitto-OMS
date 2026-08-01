import Link from 'next/link';
import { PAGE_SIZE_OPTIONS } from '@/lib/pagination';

// Plain presentational component -- no hooks, no "use client" -- so it renders identically
// whether the parent is a Server Component (reports) or a Client Component (OrdersList, which
// feeds it a live-updated visibleCount after local row removals from inline edits).
type PaginationBarProps = {
  page: number;
  pageSize: number;
  totalCount: number;
  visibleCount: number;
  itemLabel: string;
  prevHref: string | null;
  nextHref: string | null;
  pageSizeHrefs: { size: number; href: string }[];
  variant?: 'full' | 'compact';
};

export default function PaginationBar({ page, pageSize, totalCount, visibleCount, itemLabel, prevHref, nextHref, pageSizeHrefs, variant = 'full' }: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const rangeStart = totalCount === 0 || visibleCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = (page - 1) * pageSize + visibleCount;

  const countText = totalCount === 0 ? `Showing 0 ${itemLabel}` : `Showing ${rangeStart}-${rangeEnd} of ${totalCount} ${itemLabel}`;

  if (variant === 'compact') {
    return <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', lineHeight: 1.3 }}>{countText}</div>;
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
        {countText}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#666' }}>
          Rows per page:
          {pageSizeHrefs.map(({ size, href }) => (
            <Link key={size} href={href} className={`nav-pill${size === pageSize ? ' active' : ''}`} style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}>
              {size}
            </Link>
          ))}
        </span>

        <span style={{ color: '#666' }}>Page {page} of {totalPages}</span>

        {prevHref ? (
          <Link href={prevHref} className="nav-pill">← Prev</Link>
        ) : (
          <span className="nav-pill" style={{ opacity: 0.4, pointerEvents: 'none' }}>← Prev</span>
        )}
        {nextHref ? (
          <Link href={nextHref} className="nav-pill">Next →</Link>
        ) : (
          <span className="nav-pill" style={{ opacity: 0.4, pointerEvents: 'none' }}>Next →</span>
        )}
      </div>
    </div>
  );
}

export { PAGE_SIZE_OPTIONS };
