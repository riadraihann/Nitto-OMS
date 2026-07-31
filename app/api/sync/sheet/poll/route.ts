import { NextResponse } from 'next/server';
import { pullAndReconcileSheet } from '@/lib/pullAndReconcileSheet';

// Independent backstop for the push-based webhook (app/api/sync/sheet/route.ts): hit on a
// schedule (external scheduler) by whoever calls this route. Pulls the sheet directly via the
// Sheets API using a service account, rather than relying on the Apps Script trigger having
// fired -- covers the case where the trigger itself silently fails or gets deleted, not just
// an occasional missed edit. Secret-protected since this is a public URL hit by an external
// scheduler; contrast with the "Sync Now" button's trigger route, which is same-origin only.
export async function GET(request: Request) {
  const env = process.env as unknown as Record<string, string | undefined>;
  const secret = env.SHEET_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'SHEET_SYNC_SECRET is not configured on the server' }, { status: 500 });
  }
  if (request.headers.get('x-sheet-sync-secret') !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const result = await pullAndReconcileSheet();
  return NextResponse.json(result, { status: result.status });
}
