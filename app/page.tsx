import { supabaseAdmin } from '@/lib/supabase';
import { computeTodayStats, computeDashboardTrends } from '@/lib/dashboardStats';
import StatTile from './components/StatTile';
import TrendChart from './components/TrendChart';

// computeTodayStats/computeDashboardTrends are cached (unstable_cache, 60s) in
// lib/dashboardStats.ts -- see the comment there for why that lives at the data-fetch layer
// rather than as a page-level `revalidate` export.
export default async function HomePage() {
  if (!supabaseAdmin) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1>Dashboard</h1>
        <p>Supabase is not configured yet.</p>
      </div>
    );
  }

  const [today, trends] = await Promise.all([computeTodayStats(), computeDashboardTrends(30)]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Today's activity (GMT+6) and recent order trends. Updates at most once a minute.</p>
        </div>
      </div>

      <div className="card">
        <div className="stat-grid">
          <StatTile label="Orders today" value={today.ordersToday} />
          <StatTile label="Items today" value={today.itemsToday} sublabel="total quantity across today's orders" />
          <StatTile
            label="Confirmed today"
            value={today.confirmedToday.total}
            sublabel={`Social ${today.confirmedToday.social} · Shopify ${today.confirmedToday.shopify}`}
            accent="good"
          />
          <StatTile label="Cancelled today" value={today.cancelledToday} accent="critical" />
          <StatTile label="Still working on it" value={today.yetToConfirmToday} sublabel="pending + active call attempts" accent="warning" />
        </div>
      </div>

      <div className="card">
        <TrendChart title="Orders per day" subtitle="last 30 days" data={trends.overall} />
      </div>

      {trends.products.map((product) => (
        <div className="card" key={product.key}>
          <TrendChart title={`${product.label} — units per day`} subtitle="last 30 days" data={product.trend} color="var(--orchid-text)" />
        </div>
      ))}
    </div>
  );
}
