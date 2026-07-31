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
  // urgency_status
  normal: { background: '#e8f5e9', color: '#2e7d32' },
  urgent: { background: '#ffebee', color: '#c62828' },
  hold: { background: '#fff8e1', color: '#ef6c00' },

  // confirmation_status
  pending: { background: '#eef1f6', color: '#3d4a63' },
  x1: { background: '#e3f2fd', color: '#1565c0' },
  x2: { background: '#cfe8fc', color: '#0d47a1' },
  x3: { background: '#d7f0ee', color: '#00695c' },
  confirmed: { background: '#e8f5e9', color: '#2e7d32' },
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
