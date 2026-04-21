import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPush } from '@/lib/push';

/**
 * TEMPORARY test endpoint — DELETE after push is confirmed working.
 * GET /api/notifications/test-push
 * Requires: Authorization: Bearer <token>
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const supabaseAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
  if (error || !user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  await sendPush(user.id, 'gw_started', {
    title: 'Test-Push von Tifo',
    body: 'Push-Notifications funktionieren! 🎉',
    link: '/account/notifications',
  });

  return NextResponse.json({ ok: true, userId: user.id });
}
