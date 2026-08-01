// Next.js renders this automatically -- client-side, no network round trip -- the instant a
// link to any page below this one is clicked, while that page's Server Component data fetch
// (a Supabase query, typically 1-3s) is still in flight. It replaces the dead multi-second
// pause where nothing visibly happened after a click.
export default function Loading() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="skeleton" style={{ width: 160, height: 26, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 280, height: 14 }} />
        </div>
        <div className="skeleton" style={{ width: 110, height: 36, borderRadius: 8 }} />
      </div>

      <div className="card" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {[70, 70, 130, 130, 130, 70].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 32 }} />
        ))}
      </div>

      <div className="card" style={{ marginTop: 'var(--space-4)', display: 'grid', gap: '0.75rem' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ border: '1px solid var(--card-border)', borderRadius: '10px', padding: '1rem 1.1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: 140, height: 12, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: 200, height: 18, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: 240, height: 12 }} />
              </div>
              <div className="skeleton" style={{ width: 90, height: 24, borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
