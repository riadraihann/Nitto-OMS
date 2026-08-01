// One KPI-style number in a card -- shared by the Call Pending header stats and the home
// dashboard (Phase 3/4), so both read as one consistent system rather than two ad-hoc layouts.

type Accent = 'default' | 'good' | 'warning' | 'critical';

const ACCENT_COLORS: Record<Exclude<Accent, 'default'>, string> = {
  good: '#2e7d32',
  warning: '#ef6c00',
  critical: '#c62828',
};

type StatTileProps = {
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: Accent;
  // Call Pending's header stats sit directly above the dense orders table, which needs every
  // spare pixel of vertical room it can get -- `dense` shrinks padding/value size for that one
  // spot without changing the home dashboard's (larger, more prominent) stat cards.
  dense?: boolean;
};

export default function StatTile({ label, value, sublabel, accent = 'default', dense = false }: StatTileProps) {
  return (
    <div className="stat-tile" style={dense ? { padding: 'var(--space-2) var(--space-3)' } : undefined}>
      <div className="stat-tile-label">{label}</div>
      <div
        className="stat-tile-value"
        style={{
          ...(dense ? { fontSize: '1.3rem', marginTop: '0.1rem' } : undefined),
          ...(accent !== 'default' ? { color: ACCENT_COLORS[accent] } : undefined),
        }}
      >
        {value}
      </div>
      {sublabel ? <div className="stat-tile-sub">{sublabel}</div> : null}
    </div>
  );
}
