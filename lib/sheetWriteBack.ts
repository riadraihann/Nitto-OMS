import { loadServiceAccountAuth, resolveSheetTabTitle, SHEET_ID, SHEETS_SCOPE } from '@/lib/googleSheetsAuth';

// Writes the reconstructed column C string (urgency marker + confirmation marker) back into
// the matching row of "Real Todays Orders" whenever a moderator changes confirmation_status
// or urgency_type/urgency_target_date in the app. Called from app/api/orders/route.ts's PATCH
// handler after a successful DB update.
//
// Loop-prevention (confirmed with the user): reads the cell first and skips the write entirely
// if it already holds the exact string being written. Combined with reconcileSheetRows.ts only
// applying a sheet-parsed confirmation/urgency value when it actually differs from the DB, this
// breaks the write -> trigger -> re-read -> write cycle: by the time our own write echoes back
// through Apps Script's onEdit/onChange trigger, the DB already matches, so nothing changes and
// nothing writes again.
export async function writeColumnC(rowNumber: number, value: string): Promise<{ ok: true; skipped: boolean } | { ok: false; error: string }> {
  const authResult = loadServiceAccountAuth([SHEETS_SCOPE]);
  if ('error' in authResult) {
    return { ok: false, error: authResult.error };
  }
  const { auth } = authResult;

  const titleResult = await resolveSheetTabTitle(auth);
  if ('error' in titleResult) {
    return { ok: false, error: titleResult.error };
  }

  const cellRange = encodeURIComponent(`'${titleResult.title}'!C${rowNumber}`);
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${cellRange}`;

  try {
    const currentResponse = await auth.request<{ values?: string[][] }>({
      url: `${baseUrl}?valueRenderOption=UNFORMATTED_VALUE`,
    });
    const currentValue = String(currentResponse.data.values?.[0]?.[0] ?? '').trim();

    if (currentValue === value.trim()) {
      return { ok: true, skipped: true };
    }

    await auth.request({
      url: `${baseUrl}?valueInputOption=RAW`,
      method: 'PUT',
      data: { range: `'${titleResult.title}'!C${rowNumber}`, values: [[value]] },
    });

    return { ok: true, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: `Sheets API write failed: ${message}` };
  }
}
