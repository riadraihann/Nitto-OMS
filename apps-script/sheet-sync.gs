// Nitto OMS sheet sync -- paste this into a bound Apps Script project on the "Real Todays"
// spreadsheet (Extensions > Apps Script). One-way, Sheet -> App only.
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
// To test: edit any cell in the "Real Todays" tab, then check Executions (left sidebar) for a
// run of onEditInstallable with a 200 response logged.

var WEBHOOK_URL = 'https://nitto-oms.vercel.app/api/sync/sheet';
var SHEET_NAME = 'Real Todays';

function syncToApp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log('Sheet "%s" not found, skipping sync', SHEET_NAME);
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
  if (e.range.getSheet().getName() !== SHEET_NAME) return;
  syncToApp();
}

// Installable onChange: catches structural changes (rows/columns inserted or deleted, sorting,
// paste operations) that onEdit misses. onChange doesn't reliably report which sheet changed,
// so it just re-syncs "Real Todays" unconditionally on any change to this spreadsheet.
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
