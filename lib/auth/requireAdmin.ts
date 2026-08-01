import { redirect } from 'next/navigation';
import { getActor, type Actor } from '@/lib/supabase/server';

// Reusable guard for admin-only Server Component pages -- call at the top before any data
// fetching. Backed up by middleware.ts's ADMIN_ONLY_ROUTE_PREFIXES for defense in depth, and by
// SiteHeader's nav filter so moderators never see a link to the page in the first place.
export async function requireAdmin(): Promise<Actor> {
  const actor = await getActor();
  if (!actor || actor.role !== 'admin') {
    redirect('/orders');
  }
  return actor;
}
