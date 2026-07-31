import { JWT } from 'google-auth-library';

export const SHEET_ID = '1onvRBeDzZ63vwSCONjA2bpD7X10Npd94KuicJxQpRo4';
// gid from the sheet URL the "Real Todays" tab was shared as (...#gid=1828206401) -- matching
// by this numeric id is unambiguous, unlike matching by title (the actual tab title on this
// spreadsheet turned out not to literally be "Real Todays")
export const SHEET_GID = 1828206401;

// Full read-write scope, not readonly: app -> sheet write-back (column C) needs edit access,
// and the service account's sharing permission on the sheet must be upgraded to Editor to
// match (it was originally set up as Viewer for the read-only poll).
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export function loadServiceAccountAuth(scopes: string[]): { auth: JWT } | { error: string } {
  const env = process.env as unknown as Record<string, string | undefined>;
  const keyJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyJson) {
    return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not configured on the server' };
  }

  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(keyJson);
  } catch {
    return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON' };
  }

  if (!credentials.client_email || !credentials.private_key) {
    return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email/private_key' };
  }

  return { auth: new JWT({ email: credentials.client_email, key: credentials.private_key, scopes }) };
}

// Google's "Unable to parse range" error fires both for genuinely malformed A1 syntax and for
// a sheet name that doesn't exist -- so instead of hardcoding a tab title anywhere, resolve the
// tab by its numeric gid (unambiguous, unlike title -- this spreadsheet has ~50 similarly-named
// tabs) once here, shared by every code path that reads or writes the sheet.
export async function resolveSheetTabTitle(auth: JWT): Promise<{ title: string } | { error: string }> {
  try {
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`;
    const metaResponse = await auth.request<{ sheets?: { properties?: { title?: string; sheetId?: number } }[] }>({ url: metaUrl });
    const sheets = metaResponse.data.sheets ?? [];
    const match = sheets.find((s) => s.properties?.sheetId === SHEET_GID);
    if (!match?.properties?.title) {
      const known = sheets.map((s) => `${s.properties?.title} (gid=${s.properties?.sheetId})`).join(', ');
      return { error: `No tab with gid=${SHEET_GID} found. Known tabs: ${known || '(none readable)'}` };
    }
    return { title: match.properties.title };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { error: `Sheets API metadata request failed: ${message}` };
  }
}
