import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  // Authenticate caller via Bearer token
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const supabaseAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { endpoint, p256dh, auth } = body ?? {};
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: 'endpoint, p256dh, auth required' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id:    user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: req.headers.get('user-agent') ?? undefined,
      },
      { onConflict: 'user_id,endpoint' }
    );

  if (error) {
    console.error('[push/subscribe]', error.message);
    return NextResponse.json({ ok: false, error: 'db error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
