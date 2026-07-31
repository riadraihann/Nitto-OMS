import { NextResponse } from 'next/server';
import { pullAndReconcileSheet } from '@/lib/pullAndReconcileSheet';

// Backs the "Sync Now" button on /orders. Same-origin browser call, so unlike the poll route
// this deliberately does NOT require SHEET_SYNC_SECRET -- that secret protects a public URL
// hit by an external scheduler/Apps Script; a same-origin POST from the app itself needs no
// separate credential, consistent with every other /api/orders route (no auth on this app).
export async function POST() {
  const result = await pullAndReconcileSheet();
  return NextResponse.json(result, { status: result.status });
}
