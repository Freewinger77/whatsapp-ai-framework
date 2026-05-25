import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';

const HIGH_SIGNAL_EVENT_TYPES = [
  'deployment.queued',
  'deployment.ready',
  'deployment.failed',
  'instance.queued',
  'instance.ready',
  'instance.failed',
  'instance.deleted',
  'instance.delete_failed',
  'api_key.rotated',
  'trial.warning',
  'trial.locked',
  'trial.vm_deletion_warning',
  'trial.vm_deleted'
];

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
  const supabase = getSupabaseAdmin() as any;

  const { data, error } = await supabase
    .from('notification_events')
    .select('id, event_type, subject, status, provider, error, metadata, created_at, sent_at')
    .eq('org_id', principal.orgId)
    .eq('provider', 'in_app')
    .in('event_type', HIGH_SIGNAL_EVENT_TYPES)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const notifications = (data ?? []).map((event: any) => ({
    id: event.id,
    eventType: event.event_type,
    title: event.subject,
    body: notificationBody(event),
    level: notificationLevel(event),
    kind: notificationKind(event),
    status: event.status,
    provider: event.provider,
    createdAt: event.created_at,
    sentAt: event.sent_at,
    readAt: notificationReadAt(event),
    metadata: event.metadata ?? {}
  }));

  return NextResponse.json({
    success: true,
    unreadCount: notifications.filter((event: { readAt: string | null }) => !event.readAt).length,
    notifications
  });
}

function notificationReadAt(event: any) {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  return typeof metadata.readAt === 'string' ? metadata.readAt : null;
}

function notificationBody(event: any) {
  if (event.error) return String(event.error);
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  if (typeof metadata.message === 'string') return metadata.message;
  if (typeof metadata.baseUrl === 'string') return metadata.baseUrl;
  if (typeof metadata.detail === 'string') return metadata.detail;
  return humanizeEventType(String(event.event_type || 'notification'));
}

function notificationLevel(event: any): 'info' | 'warn' | 'success' {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  if (metadata.severity === 'error' || metadata.severity === 'warning') return 'warn';
  if (metadata.severity === 'success') return 'success';
  const eventType = String(event.event_type || '');
  if (event.status === 'failed' || eventType.includes('failed') || eventType.includes('warning')) return 'warn';
  if (eventType.includes('ready') || eventType.includes('sent')) return 'success';
  return 'info';
}

function notificationKind(event: any) {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  return typeof metadata.kind === 'string' ? metadata.kind : String(event.event_type || 'notification').split(/[._-]+/)[0];
}

function humanizeEventType(value: string) {
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
