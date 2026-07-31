import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Single-row archive/restore already goes through the generic PATCH /api/orders endpoint
// (which logs to order_history automatically via its diff). This endpoint exists only for the
// multi-select "Archive selected" / "Restore selected" action on /orders, so a bulk action is
// one DB round-trip instead of N sequential PATCHes -- same reasoning as the sheet-sync
// performance fix.
export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }

  try {
    const payload = await request.json();
    const ids = Array.isArray(payload?.ids) ? (payload.ids as unknown[]).map(Number).filter(Number.isFinite) : [];
    const archive = Boolean(payload?.archive);

    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: 'No order ids provided' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const archivedAtValue = archive ? nowIso : null;

    const { data, error } = await supabaseAdmin
      .from('orders')
      .update({ archived_at: archivedAtValue })
      .in('id', ids)
      .select('id');

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const updatedIds = (data ?? []).map((row) => row.id);
    const historyRows = updatedIds.map((id) => ({
      order_id: id,
      field: 'archived_at',
      old_value: archive ? null : nowIso,
      new_value: archivedAtValue,
      source: 'moderator',
      actor: null,
    }));

    if (historyRows.length > 0) {
      const { error: historyError } = await supabaseAdmin.from('order_history').insert(historyRows);
      if (historyError) {
        console.error('order_history bulk archive insert failed', historyError.message);
      }
    }

    return NextResponse.json({ ok: true, updatedIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
