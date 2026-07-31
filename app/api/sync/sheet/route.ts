import { NextResponse } from 'next/server';
import { reconcileSheetRows } from '@/lib/reconcileSheetRows';

// Push endpoint: Apps Script calls this on every edit/change to the "Real Todays" sheet,
// sending its full current contents. See lib/reconcileSheetRows.ts for the actual sync logic
// (shared with the periodic backstop poll at app/api/sync/sheet/poll/route.ts).
export async function POST(request: Request) {
  const env = process.env as unknown as Record<string, string | undefined>;
  const secret = env.SHEET_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'SHEET_SYNC_SECRET is not configured on the server' }, { status: 500 });
  }
  if (request.headers.get('x-sheet-sync-secret') !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const rows = payload?.rows;
    if (!Array.isArray(rows)) {
      return NextResponse.json({ ok: false, error: 'Expected { rows: any[][] }' }, { status: 400 });
    }

    const result = await reconcileSheetRows(rows);
    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
