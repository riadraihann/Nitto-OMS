import { NextResponse } from 'next/server';
import { JWT } from 'google-auth-library';
import { reconcileSheetRows } from '@/lib/reconcileSheetRows';

const SHEET_ID = '1onvRBeDzZ63vwSCONjA2bpD7X10Npd94KuicJxQpRo4';
const SHEET_TAB = 'Real Todays';

// Independent backstop for the push-based webhook (app/api/sync/sheet/route.ts): hit on a
// schedule (Vercel Cron, or an external scheduler) by whoever calls this route. Pulls the
// sheet directly via the Sheets API using a service account, rather than relying on the Apps
// Script trigger having fired -- covers the case where the trigger itself silently fails or
// gets deleted, not just an occasional missed edit.
export async function GET(request: Request) {
  const env = process.env as unknown as Record<string, string | undefined>;
  const secret = env.SHEET_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'SHEET_SYNC_SECRET is not configured on the server' }, { status: 500 });
  }
  if (request.headers.get('x-sheet-sync-secret') !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const keyJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyJson) {
    return NextResponse.json({ ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not configured on the server' }, { status: 500 });
  }

  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(keyJson);
  } catch {
    return NextResponse.json({ ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON' }, { status: 500 });
  }

  if (!credentials.client_email || !credentials.private_key) {
    return NextResponse.json({ ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email/private_key' }, { status: 500 });
  }

  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  // UNFORMATTED_VALUE: numbers come back as JS numbers (not "1,200" display strings) and
  // plain-text dates come back untouched -- both are what parseSheetRow expects
  const range = encodeURIComponent(`'${SHEET_TAB}'!A:ZZ`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;

  let values: unknown[][] = [];
  try {
    const response = await auth.request<{ values?: unknown[][] }>({ url });
    values = response.data.values ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: `Sheets API request failed: ${message}` }, { status: 502 });
  }

  const result = await reconcileSheetRows(values);
  return NextResponse.json(result, { status: result.status });
}
