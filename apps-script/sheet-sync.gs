// Nitto OMS sheet sync -- paste this into a bound Apps Script project on the order-tracking
// spreadsheet (Extensions > Apps Script). Targets a specific tab by gid (see SHEET_GID below),
// not by name -- this spreadsheet has ~50 similarly-named tabs.
//
// Sheet -> App direction only; this script never writes anything. App -> Sheet write-back
// (column C, when a moderator changes confirmation/urgency in the app) happens server-side via
// the service account, not through this script -- but note that a write-back IS itself an edit
// to the sheet, so it WILL fire onEditInstallable below and re-sync. That's expected and
// harmless: the app's own loop-prevention logic recognizes its own echoed-back value as
// already-applied and skips reprocessing it.
//
// Setup (do this once):
//   1. Extensions > Apps Script, paste this whole file in as Code.gs (replacing the default).
//   2. Project Settings (gear icon) > Script Properties > add property
//        SHEET_SYNC_SECRET = <the value the app team gave you>
//   3. Back in the editor, select the "runSetup" function from the dropdown and click Run.
//      Google will prompt you to authorize the script (it needs permission to make external
//      requests and manage triggers on this file) -- approve it.
//   4. Confirm it worked: Triggers (clock icon, left sidebar) should now show two triggers,
//      "onEditInstallable" and "onChangeInstallable", both on this spreadsheet.
//
// To test: edit any cell in the target tab, then check Executions (left sidebar) for a
// run of onEditInstallable with a 200 response logged.

var WEBHOOK_URL = 'https://nitto-oms.vercel.app/api/sync/sheet';
// gid from the tab's URL (...#gid=1828206401) -- matching by this numeric id is unambiguous,
// unlike matching by title (this spreadsheet has ~50 tabs, several with similar names)
var SHEET_GID = 1828206401;

function getTargetSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === SHEET_GID) return sheets[i];
  }
  return null;
}

function syncToApp() {
  var sheet = getTargetSheet_();
  if (!sheet) {
    Logger.log('No sheet with gid=%s found, skipping sync', SHEET_GID);
    return;
  }

  var secret = PropertiesService.getScriptProperties().getProperty('SHEET_SYNC_SECRET');
  if (!secret) {
    Logger.log('SHEET_SYNC_SECRET script property is not set -- see setup instructions at top of file');
    return;
  }

  var rows = sheet.getDataRange().getValues();

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ rows: rows }),
    headers: { 'X-Sheet-Sync-Secret': secret },
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(WEBHOOK_URL, options);
  Logger.log('Sync response: %s %s', response.getResponseCode(), response.getContentText());
}

// Installable onEdit: only fires (and only syncs) for manual cell edits on the target sheet.
// Simple onEdit(e) functions can't call UrlFetchApp, hence installing this explicitly.
function onEditInstallable(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getSheetId() !== SHEET_GID) return;
  syncToApp();
}

// Installable onChange: catches structural changes (rows/columns inserted or deleted, sorting,
// paste operations) that onEdit misses. onChange doesn't reliably report which sheet changed,
// so it just re-syncs the target tab unconditionally on any change to this spreadsheet.
function onChangeInstallable(e) {
  syncToApp();
}

// Run this once from the Apps Script editor to (re)install both triggers. Safe to re-run --
// it clears any existing triggers for these two handlers first, so it won't create duplicates.
function runSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    var handler = existing[i].getHandlerFunction();
    if (handler === 'onEditInstallable' || handler === 'onChangeInstallable') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }

  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onChangeInstallable').forSpreadsheet(ss).onChange().create();

  Logger.log('Triggers installed.');
}
