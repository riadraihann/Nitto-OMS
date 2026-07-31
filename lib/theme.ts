export const colors = {
  navy: '#0a2472',
  navyDark: '#071a54',
  navyTint: '#eaeef7',
  // orchid is a fill/background color only -- white text on it fails WCAG contrast (~2.9:1).
  // Use orchidText (a darker same-hue magenta, ~5.5:1 on white) for links/text; anything
  // filled with orchid should pair with navy text (~4.8:1), not white.
  orchid: '#da70d6',
  orchidText: '#a83aa3',
  orchidTint: '#fbeafa',
  border: '#e0e2e8',
  textMuted: '#666',
};

// Confirmation/delivery badge colors are a fresh, muted palette that avoids red/yellow
// (reserved for urgency) and avoids purple/violet (too close to the orchid accent).
// The urgency badge below intentionally keeps its original red/yellow/green -- those are
// warning colors, not part of the new brand palette, and must stay visually distinct.
export const statusBadgeColors: Record<string, { background: string; color: string }> = {
  // urgency_type
  normal: { background: '#e8f5e9', color: '#2e7d32' },
  urgent: { background: '#ffebee', color: '#c62828' },
  hold: { background: '#fff8e1', color: '#ef6c00' },
  vu: { background: '#ffebee', color: '#c62828' }, // same red as urgent, per spec
  d: { background: '#e3f2fd', color: '#1565c0' }, // neutral/informational, not alarming

  // confirmation_status
  pending: { background: '#eef1f6', color: '#3d4a63' },
  x1: { background: '#e3f2fd', color: '#1565c0' },
  x2: { background: '#cfe8fc', color: '#0d47a1' },
  x3: { background: '#d7f0ee', color: '#00695c' },
  confirmed_m: { background: '#e8f5e9', color: '#2e7d32' },
  confirmed_wa: { background: '#e8f5e9', color: '#2e7d32' },
  confirmed_c: { background: '#e8f5e9', color: '#2e7d32' },
  cancelled: { background: '#f0f0f0', color: '#616161' },

  // delivery_status
  packaging: { background: '#f1ece3', color: '#7a5c3e' },
  sent_to_courier: { background: '#e0f7fa', color: '#00838f' },
  delivered: { background: '#e8f5e9', color: '#2e7d32' },
  returned: { background: '#f5e6da', color: '#8a5a2b' },
};

export function statusBadgeStyle(status: string) {
  return statusBadgeColors[status] ?? { background: '#f5f5f5', color: '#616161' };
}

// The three "confirmed" variants and a few others don't read well through a plain CSS
// text-transform:capitalize (e.g. "confirmed_m" -> "Confirmed_m"), so badge/label text
// should go through this instead of the raw stored value.
const statusLabels: Record<string, string> = {
  confirmed_m: 'Confirmed (M)',
  confirmed_wa: 'Confirmed (Wa)',
  confirmed_c: 'Confirmed (C)',
  x1: 'X1',
  x2: 'X2',
  x3: 'X3',
  sent_to_courier: 'Sent to courier',
};

export function statusLabel(status: string): string {
  return statusLabels[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

// shared option lists for the confirmation/delivery/urgency selects on both the order detail
// page and the inline row editors on /orders
export const confirmationSteps = ['pending', 'x1', 'x2', 'x3', 'confirmed_m', 'confirmed_wa', 'confirmed_c', 'cancelled'];
export const deliveryOptions = ['packaging', 'sent_to_courier', 'delivered', 'returned'];
export const urgencyTypeOptions = ['normal', 'urgent', 'hold', 'vu', 'd'];

// "Call Pending" view (/orders?view=call-pending): shopify orders still needing a call.
// Shared between the server-side filter query and the client list, which uses it to drop a
// row out of view the instant it's marked confirmed/cancelled via the inline editor -- without
// this shared source of truth the two could silently drift apart.
export const CALL_PENDING_STAGES = ['pending', 'x1', 'x2', 'x3'];

// The /orders <-> /history split: an order is "history" once it's shipped (sent to courier or
// already delivered), "active" otherwise. Shared between both pages' server queries and
// OrdersList's client-side row removal, so an inline delivery_status edit that crosses this
// boundary makes the row vanish from whichever tab it's currently being viewed on immediately,
// not just after a reload. A "delivered" order later marked "returned" moves back OUT of
// history (returned is active -- it needs processing), which falls out naturally from this
// list not including 'returned'.
export const HISTORY_DELIVERY_STATUSES = ['sent_to_courier', 'delivered'];

export function isHistoryDelivery(deliveryStatus: string): boolean {
  return HISTORY_DELIVERY_STATUSES.includes(deliveryStatus);
}

const urgencyTypeLabels: Record<string, string> = {
  vu: 'VU (Very Urgent)',
  d: 'D (Dispatch)',
};

// dropdown option text -- explains what vu/d mean, since the compact badge form doesn't
export function urgencyTypeOptionLabel(type: string): string {
  return urgencyTypeLabels[type] ?? statusLabel(type);
}

// badge/display text: "VU (05)" / "D (12)" using the day-of-month from the resolved target
// date -- urgency_target_date is stored as a plain date (no time/tz), so read the day back
// with getUTCDate() to avoid a local-timezone off-by-one
export function urgencyLabel(type: string, targetDate: string | null): string {
  if ((type === 'vu' || type === 'd') && targetDate) {
    const day = new Date(targetDate).getUTCDate();
    return `${type.toUpperCase()} (${String(day).padStart(2, '0')})`;
  }
  return statusLabel(type);
}

// Phone numbers in this dataset are entered inconsistently (with/without leading 0, with/
// without the 880 country code), so normalize to E.164 for the tel: href while still
// displaying the raw stored text -- staff should see exactly what's on file.
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('880')) return `tel:+${digits}`;
  if (digits.startsWith('0')) return `tel:+880${digits.slice(1)}`;
  return `tel:+880${digits}`;
}
