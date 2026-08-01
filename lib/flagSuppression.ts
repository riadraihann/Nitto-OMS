import { logOrderHistory } from '@/lib/orderHistory.mjs';

const RESOLVED_GRACE_MS = 24 * 60 * 60 * 1000;

export type FlagStatus = 'resolved' | 'ignored';
export type SourceSystem = 'needs_review' | 'attention_needed';

export type ExistingFlag = {
  flag_type: string;
  status: FlagStatus;
  acted_at: string;
  actor_name: string | null;
};

export type SuppressionResult = {
  visibleFlagTypes: string[];
  // flag_types that came back after being resolved -- caller deletes the row and logs a
  // flag_reflagged history entry so it shows up as a fresh, unactioned flag.
  reflagged: string[];
};

// Pure -- no I/O, `now` passed in for testability. Resolved suppression is a flat 24h grace
// window from acted_at, NOT a "went false then true again" state transition: if the underlying
// issue was never actually fixed (stays continuously true), it must still come back after the
// window, or "Mark Resolved" would be indistinguishable from "Ignore" for anything that's never
// actually addressed.
export function resolveFlagVisibility(rawActiveFlagTypes: string[], existingFlags: ExistingFlag[], now: Date): SuppressionResult {
  const rawActiveSet = new Set(rawActiveFlagTypes);
  const existingByType = new Map(existingFlags.map((flag) => [flag.flag_type, flag]));
  const allFlagTypes = new Set([...rawActiveFlagTypes, ...Array.from(existingByType.keys())]);

  const visibleFlagTypes: string[] = [];
  const reflagged: string[] = [];

  for (const flagType of Array.from(allFlagTypes)) {
    const isRawActive = rawActiveSet.has(flagType);
    const existing = existingByType.get(flagType);

    if (!existing) {
      if (isRawActive) visibleFlagTypes.push(flagType);
      continue;
    }

    if (existing.status === 'ignored') {
      // unconditionally sticky -- permanent-per-instance, no bookkeeping needed
      continue;
    }

    // status === 'resolved'
    if (!isRawActive) continue;

    const actedAtMs = new Date(existing.acted_at).getTime();
    if (now.getTime() - actedAtMs >= RESOLVED_GRACE_MS) {
      visibleFlagTypes.push(flagType);
      reflagged.push(flagType);
    }
  }

  return { visibleFlagTypes, reflagged };
}

// Shared I/O glue for the `reflagged` output above -- deletes the stale resolved row (reverting
// to "no row = active, needs a fresh decision") and logs a breadcrumb noting the prior resolution.
// Never throws -- a logging/bookkeeping hiccup here must not break rendering the flags themselves.
export async function applyReflaggedFlags(
  supabaseClient: any,
  orderId: number,
  reflaggedFlagTypes: string[],
  existingFlags: ExistingFlag[]
): Promise<void> {
  if (reflaggedFlagTypes.length === 0) return;

  const existingByType = new Map(existingFlags.map((flag) => [flag.flag_type, flag]));

  try {
    const { error } = await supabaseClient.from('flags').delete().eq('order_id', orderId).in('flag_type', reflaggedFlagTypes);
    if (error) {
      console.error('flags delete (reflag) failed', error.message);
      return;
    }
  } catch (error) {
    console.error('flags delete (reflag) threw', error instanceof Error ? error.message : error);
    return;
  }

  for (const flagType of reflaggedFlagTypes) {
    const previous = existingByType.get(flagType);
    await logOrderHistory(
      supabaseClient,
      orderId,
      [{ field: 'flag_reflagged', old_value: previous?.actor_name ?? null, new_value: flagType }],
      'flag_action',
      null
    );
  }
}
