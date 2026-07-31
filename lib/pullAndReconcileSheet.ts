import { loadServiceAccountAuth, resolveSheetTabTitle, SHEET_ID, SHEETS_SCOPE } from '@/lib/googleSheetsAuth';
import { reconcileSheetRows, type ReconcileResult } from '@/lib/reconcileSheetRows';

// Pulls the sheet's current full contents via the Sheets API using the service account, then
// reconciles. Shared by the periodic backstop poll (app/api/sync/sheet/poll/route.ts) and the
// on-demand "Sync Now" button (app/api/sync/sheet/trigger/route.ts) -- both want the exact same
// behavior, just triggered differently.
export async function pullAndReconcileSheet(): Promise<ReconcileResult> {
  const authResult = loadServiceAccountAuth([SHEETS_SCOPE]);
  if ('error' in authResult) {
    return { ok: false, status: 500, error: authResult.error };
  }
  const { auth } = authResult;

  const titleResult = await resolveSheetTabTitle(auth);
  if ('error' in titleResult) {
    return { ok: false, status: 502, error: titleResult.error };
  }

  // UNFORMATTED_VALUE: numbers come back as JS numbers (not "1,200" display strings) and
  // plain-text dates come back untouched -- both are what parseSheetRow expects
  const range = encodeURIComponent(`'${titleResult.title}'!A:ZZ`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;

  let values: unknown[][] = [];
  try {
    const response = await auth.request<{ values?: unknown[][] }>({ url });
    values = response.data.values ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, status: 502, error: `Sheets API request failed: ${message}` };
  }

  return reconcileSheetRows(values);
}
