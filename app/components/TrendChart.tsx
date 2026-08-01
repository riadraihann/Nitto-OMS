// A deliberately plain server-rendered bar chart -- no client JS, no animation, no charting
// library. The home dashboard needs to stay fast as order volume grows, and a single static
// <svg> costs nothing to render or hydrate. Not interactive (no hover tooltip): the two direct
// value labels (peak day, today) carry the numbers that matter without needing a client component.

export type TrendPoint = { day: string; value: number };

type TrendChartProps = {
  title: string;
  subtitle?: string;
  data: TrendPoint[];
  color?: string;
};

const WIDTH = 600;
const HEIGHT = 160;
const PAD_TOP = 20;
const PAD_BOTTOM = 20;
const PAD_X = 4;

function formatDayLabel(day: string) {
  const [, m, d] = day.split('-').map(Number);
  // year is irrelevant here -- only the month/day name is shown, so any fixed year works
  return new Date(Date.UTC(2000, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function TrendChart({ title, subtitle, data, color = 'var(--navy)' }: TrendChartProps) {
  const n = data.length;
  const max = Math.max(1, ...data.map((d) => d.value));
  const plotWidth = WIDTH - PAD_X * 2;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const slot = n > 0 ? plotWidth / n : 0;
  const barWidth = Math.max(2, slot - 3);
  const maxIndex = data.reduce((best, point, i) => (point.value > data[best].value ? i : best), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
        {subtitle ? <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{subtitle}</span> : null}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} preserveAspectRatio="none" role="img" aria-label={title}>
        <line x1={PAD_X} y1={HEIGHT - PAD_BOTTOM} x2={WIDTH - PAD_X} y2={HEIGHT - PAD_BOTTOM} stroke="var(--card-border)" strokeWidth={1} />
        {data.map((point, i) => {
          const x = PAD_X + i * slot + (slot - barWidth) / 2;
          const barHeight = point.value > 0 ? Math.max(2, (point.value / max) * plotHeight) : 0;
          const y = HEIGHT - PAD_BOTTOM - barHeight;
          const isLast = i === n - 1;
          const isPeak = i === maxIndex && point.value > 0;
          return (
            <g key={point.day}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx={Math.min(3, barWidth / 2)} fill={color} opacity={isLast ? 1 : 0.5} />
              {isLast || isPeak ? (
                <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">
                  {point.value}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
        <span>{data[0] ? formatDayLabel(data[0].day) : ''}</span>
        <span>{data[Math.floor((n - 1) / 2)] ? formatDayLabel(data[Math.floor((n - 1) / 2)].day) : ''}</span>
        <span>{data[n - 1] ? formatDayLabel(data[n - 1].day) : ''}</span>
      </div>
    </div>
  );
}
