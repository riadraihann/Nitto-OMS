"use client";

import { useRouter } from 'next/navigation';
import FlagActions from '@/app/components/FlagActions';

type AttentionFlagActionsProps = {
  orderId: number;
  flagType: string;
};

// This page is a force-dynamic server component re-fetching computeAttentionNeededWithFlags on
// every load, so router.refresh() (re-running the server render) is enough to make an
// actioned flag disappear -- no local list state to reconcile, unlike OrdersList.
export default function AttentionFlagActions({ orderId, flagType }: AttentionFlagActionsProps) {
  const router = useRouter();
  return <FlagActions orderId={orderId} flagType={flagType} sourceSystem="attention_needed" onActioned={() => router.refresh()} />;
}
