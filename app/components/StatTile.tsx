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
};

export default function StatTile({ label, value, sublabel, accent = 'default' }: StatTileProps) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value" style={accent !== 'default' ? { color: ACCENT_COLORS[accent] } : undefined}>
        {value}
      </div>
      {sublabel ? <div className="stat-tile-sub">{sublabel}</div> : null}
    </div>
  );
}
