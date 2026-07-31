import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabaseAdmin } from '@/lib/supabase';

type OrderItem = {
  product_name: string;
  quantity: number;
  unit_price: number;
};

type ExportOrder = {
  id: number;
  order_number: string | null;
  created_at: string;
  customer_name: string;
  phone: string;
  address: string;
  special_instructions: string | null;
  total_amount: number | null;
  order_items: OrderItem[];
};

// original sheet timestamps were entered as Asia/Dhaka wall-clock time
function formatDhaka(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }

  try {
    const payload = await request.json();
    const ids = payload?.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ ok: false, error: 'No order ids provided' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, created_at, customer_name, phone, address, special_instructions, total_amount, order_items(product_name, quantity, unit_price)')
      .in('id', ids);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const orderById = new Map((data as ExportOrder[] | null ?? []).map((order) => [order.id, order]));
    // preserve the selection/display order the caller sent, not whatever order Postgres returns for .in()
    const orderedRows = (ids as number[]).map((id) => orderById.get(id)).filter((o): o is ExportOrder => Boolean(o));

    const maxItems = orderedRows.reduce((max, order) => Math.max(max, (order.order_items ?? []).length), 0);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Orders');

    // mirrors the original import CSV's column layout: date, order number, notes, customer,
    // phone, address, city/zone/payment (not stored in the app, left blank to preserve position),
    // bill amount, then item name/qty pairs repeated per line item
    const header = ['Date', 'Order Number', 'Notes', 'Customer Name', 'Phone', 'Address', 'City', 'Zone Code', '', 'Payment Method', 'Bill Amount'];
    for (let i = 1; i <= maxItems; i += 1) {
      header.push(`Item ${i}`, `Qty ${i}`);
    }
    sheet.addRow(header);
    sheet.getRow(1).font = { bold: true };

    for (const order of orderedRows) {
      const items = order.order_items ?? [];
      const computedSubtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

      const row: (string | number)[] = [
        formatDhaka(order.created_at),
        order.order_number ?? '',
        order.special_instructions ?? '',
        order.customer_name ?? '',
        order.phone ?? '',
        order.address ?? '',
        '',
        '',
        '',
        '',
        order.total_amount ?? computedSubtotal,
      ];

      for (const item of items) {
        row.push(item.product_name, item.quantity);
      }

      sheet.addRow(row);
    }

    sheet.columns.forEach((column) => {
      column.width = 18;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `orders-export-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
