import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getActor } from '@/lib/supabase/server';
import { logOrderHistory } from '@/lib/orderHistory.mjs';

const VALID_SOURCE_SYSTEMS = new Set(['needs_review', 'attention_needed']);
const VALID_STATUSES = new Set(['resolved', 'ignored']);

export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }

  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const orderId = Number(payload?.order_id);
    const flagType = String(payload?.flag_type ?? '');
    const sourceSystem = String(payload?.source_system ?? '');
    const status = String(payload?.status ?? '');
    const note = typeof payload?.note === 'string' ? payload.note.trim() : '';

    if (!orderId || !flagType || !VALID_SOURCE_SYSTEMS.has(sourceSystem) || !VALID_STATUSES.has(status)) {
      return NextResponse.json({ ok: false, error: 'order_id, flag_type, source_system, and a valid status are required' }, { status: 400 });
    }
    // "why did we decide this wasn't a real issue" matters more for false positives than for
    // confirmed fixes -- Resolved's note stays optional, Ignore's is required.
    if (status === 'ignored' && !note) {
      return NextResponse.json({ ok: false, error: 'A reason is required to ignore a flag' }, { status: 400 });
    }

    const { error: upsertError } = await supabaseAdmin
      .from('flags')
      .upsert(
        {
          order_id: orderId,
          flag_type: flagType,
          source_system: sourceSystem,
          status,
          note: note || null,
          actor_email: actor.email,
          actor_name: actor.name,
          acted_at: new Date().toISOString(),
        },
        { onConflict: 'order_id,flag_type' }
      );

    if (upsertError) {
      return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 });
    }

    const { data: persisted, error: selectError } = await supabaseAdmin
      .from('flags')
      .select('*')
      .eq('order_id', orderId)
      .eq('flag_type', flagType)
      .single();

    if (selectError) {
      return NextResponse.json({ ok: false, error: selectError.message }, { status: 500 });
    }

    await logOrderHistory(
      supabaseAdmin,
      orderId,
      [{ field: `flag_${status}`, old_value: null, new_value: flagType }],
      'flag_action',
      actor.name
    );

    return NextResponse.json({ ok: true, data: persisted });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  try {
    let query = supabaseAdmin
      .from('flags')
      .select('*, orders(order_number, customer_name)')
      .order('acted_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
