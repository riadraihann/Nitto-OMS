import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get('id');

  if (!orderId) {
    return NextResponse.json({ ok: false, error: 'Order id is required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('order_history')
    .select('id, field, old_value, new_value, source, actor, changed_at')
    .eq('order_id', orderId)
    .order('changed_at', { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}
