import nodemailer from 'nodemailer';
import { getClerkUserEmail } from './auth';
import { getServerEnv } from './env';
import { getSupabaseAdmin } from './supabase-admin';

type OrgNotificationInput = {
  orgId: string;
  eventType: AppNotificationEventType;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

type AppNotificationSeverity = 'info' | 'success' | 'warning' | 'error';
type AppNotificationKind = 'deployment' | 'instance' | 'security' | 'trial' | 'billing';
type AppNotificationEventType =
  | 'deployment.queued'
  | 'deployment.provisioning'
  | 'deployment.dns_pending'
  | 'deployment.ready'
  | 'deployment.waiting'
  | 'deployment.failed'
  | 'instance.queued'
  | 'instance.ready'
  | 'instance.failed'
  | 'instance.deleted'
  | 'instance.delete_failed'
  | 'api_key.rotated'
  | 'trial.warning'
  | 'trial.locked'
  | 'trial.vm_deletion_warning'
  | 'trial.vm_deleted'
  | 'billing.grace_started'
  | 'billing.grace_warning'
  | 'billing.locked'
  | 'billing.restored'
  | 'billing.instance_deletion_warning'
  | 'billing.instances_deleted';

export async function notifyOrgAdmins(input: OrgNotificationInput) {
  const recipients = await getOrgAdminEmails(input.orgId);
  if (!recipients.length) {
    await recordNotification({
      ...input,
      recipient: 'unknown',
      status: 'skipped',
      error: 'No owner/admin email recipients found'
    });
    return { sent: 0, skipped: 1, recipients: [] };
  }

  let sent = 0;
  let skipped = 0;
  for (const recipient of recipients) {
    const result = await sendNotificationEmail({
      ...input,
      recipient,
      idempotencyKey: `${input.idempotencyKey}:${recipient}`
    });
    if (result.sent) sent += 1;
    if (result.skipped) skipped += 1;
  }

  return { sent, skipped, recipients };
}

export async function recordOrgNotificationEvent(input: OrgNotificationInput & {
  status?: 'queued' | 'sent' | 'failed' | 'skipped';
  provider?: string;
  recipient?: string;
  error?: string | null;
}) {
  return recordNotification({
    ...input,
    recipient: input.recipient || `org:${input.orgId}`,
    status: input.status || 'sent',
    provider: input.provider || 'in_app',
    error: input.error ?? null
  });
}

export async function recordAppNotification(input: {
  orgId: string;
  eventType: AppNotificationEventType;
  kind: AppNotificationKind;
  severity: AppNotificationSeverity;
  title: string;
  body: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  status?: 'sent' | 'failed';
  error?: string | null;
}) {
  const body = redactSensitiveText(input.body);
  const error = input.error ? redactSensitiveText(input.error) : null;
  return recordOrgNotificationEvent({
    orgId: input.orgId,
    eventType: input.eventType,
    subject: input.title,
    text: body,
    idempotencyKey: input.idempotencyKey,
    status: input.status || (input.severity === 'error' ? 'failed' : 'sent'),
    provider: 'in_app',
    error,
    metadata: {
      ...(input.metadata ?? {}),
      kind: input.kind,
      severity: input.severity,
      message: body
    }
  });
}

export async function notifyInstanceReady(input: {
  orgId: string;
  instanceId: string;
  instanceName: string;
  baseUrl?: string | null;
}) {
  const dashboardUrl = process.env.WASUP_DASHBOARD_URL || 'https://dev.wasup.co';
  const instanceUrl = `${dashboardUrl.replace(/\/$/, '')}/#/instances/${input.instanceId}`;
  const body = input.baseUrl
    ? `${input.instanceName} is provisioned on your workspace (${input.baseUrl}). Open the dashboard to connect WhatsApp.`
    : `${input.instanceName} is provisioned on your workspace. Open the dashboard to connect WhatsApp.`;

  await recordAppNotification({
    orgId: input.orgId,
    eventType: 'instance.ready',
    kind: 'instance',
    severity: 'success',
    title: 'Instance created',
    body,
    idempotencyKey: `in-app:instance-ready:${input.instanceId}`,
    metadata: {
      instanceId: input.instanceId,
      instanceName: input.instanceName,
      baseUrl: input.baseUrl ?? null
    }
  });

  return notifyOrgAdmins({
    orgId: input.orgId,
    eventType: 'instance.ready',
    subject: 'Your WhatsApp instance is ready',
    text: `${body}\n\nOpen Wasup: ${instanceUrl}`,
    html: `<p>${body}</p><p><a href="${instanceUrl}">Open your instance in Wasup</a></p>`,
    idempotencyKey: `email:instance-ready:${input.instanceId}`,
    metadata: {
      instanceId: input.instanceId,
      instanceName: input.instanceName,
      baseUrl: input.baseUrl ?? null
    }
  });
}

export async function notifyDeploymentReady(input: {
  orgId: string;
  deploymentId: string;
  baseUrl: string;
}) {
  const dashboardUrl = process.env.WASUP_DASHBOARD_URL || 'https://dev.wasup.co';

  await recordAppNotification({
    orgId: input.orgId,
    eventType: 'deployment.ready',
    kind: 'deployment',
    severity: 'success',
    title: 'Workspace ready',
    body: `Your Wasup worker is ready at ${input.baseUrl}.`,
    idempotencyKey: `in-app:deployment-ready:${input.deploymentId}`,
    metadata: { deploymentId: input.deploymentId, baseUrl: input.baseUrl }
  });

  return notifyOrgAdmins({
    orgId: input.orgId,
    eventType: 'deployment.ready',
    subject: 'Your Wasup workspace is ready',
    text: `Your Wasup worker is ready at ${input.baseUrl}. You can now connect your WhatsApp instances.\n\nOpen Wasup: ${dashboardUrl}`,
    html: `<p>Your Wasup worker is ready at <a href="${input.baseUrl}">${input.baseUrl}</a>.</p><p>You can now connect your WhatsApp instances.</p><p><a href="${dashboardUrl}">Open Wasup</a></p>`,
    idempotencyKey: `email:deployment-ready:${input.deploymentId}`,
    metadata: { deploymentId: input.deploymentId, baseUrl: input.baseUrl }
  });
}

export async function recordDeploymentStatusNotification(input: {
  orgId: string;
  deploymentId: string;
  status: string;
  baseUrl?: string | null;
  message?: string | null;
  detail?: string | null;
}) {
  if (input.status !== 'queued') return { skipped: true };

  const copy = deploymentStatusCopy(input.status, input.message);
  return recordAppNotification({
    orgId: input.orgId,
    eventType: 'deployment.queued',
    kind: 'deployment',
    severity: 'info',
    title: copy.subject,
    body: copy.text,
    idempotencyKey: `in-app:deployment-status:${input.deploymentId}:${input.status}`,
    metadata: {
      deploymentId: input.deploymentId,
      baseUrl: input.baseUrl ?? null,
      status: input.status,
      detail: input.detail ?? null
    }
  });
}

async function getOrgAdminEmails(orgId: string) {
  const supabase = getSupabaseAdmin() as any;
  const { data: members, error } = await supabase
    .from('organization_members')
    .select('clerk_user_id, role')
    .eq('org_id', orgId);

  if (error) throw new Error(error.message);

  const admins = (members ?? []).filter((member: { role: string }) => member.role === 'owner' || member.role === 'admin');
  const recipients = admins.length ? admins : (members ?? []);

  const emails = new Set<string>();
  for (const member of recipients) {
    const email = await getClerkUserEmail(member.clerk_user_id);
    if (email) emails.add(email);
  }

  return Array.from(emails);
}

async function sendNotificationEmail(input: OrgNotificationInput & { recipient: string }) {
  const env = getServerEnv();
  const notification = await recordNotification({
    ...input,
    status: env.SMTP_HOST && env.SMTP_FROM ? 'queued' : 'skipped',
    error: env.SMTP_HOST && env.SMTP_FROM ? null : 'SMTP is not configured'
  });

  if (notification.duplicate) return { sent: false, skipped: true };
  if (!env.SMTP_HOST || !env.SMTP_FROM) return { sent: false, skipped: true };

  try {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER && env.SMTP_PASS
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS
          }
        : undefined
    });

    await transport.sendMail({
      from: env.SMTP_FROM,
      to: input.recipient,
      subject: input.subject,
      text: input.text,
      html: input.html
    });

    await updateNotification(notification.id, {
      status: 'sent',
      sent_at: new Date().toISOString(),
      error: null
    });
    return { sent: true, skipped: false };
  } catch (error) {
    await updateNotification(notification.id, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    });
    return { sent: false, skipped: false };
  }
}

function deploymentStatusCopy(status: string, message?: string | null) {
  if (message) {
    return {
      subject: humanizeDeploymentStatus(status),
      text: message
    };
  }

  switch (status) {
    case 'queued':
      return {
        subject: 'Workspace provisioning queued',
        text: 'Your workspace provisioning request has been queued.'
      };
    case 'provisioning':
      return {
        subject: 'Workspace provisioning started',
        text: 'Azure resources are being prepared for your workspace.'
      };
    case 'dns_pending':
      return {
        subject: 'Workspace verification in progress',
        text: 'The worker is provisioned and DNS, HTTPS, and health checks are being verified.'
      };
    default:
      return {
        subject: humanizeDeploymentStatus(status),
        text: `Workspace deployment status changed to ${status}.`
      };
  }
}

function humanizeDeploymentStatus(status: string) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(api[_-]?key|authorization|bearer|token|secret|password)(["'\s:=]+)([^"',\s}]+)/gi, '$1$2[redacted]')
    .replace(/wasup_(live|test)_[A-Za-z0-9._-]+/g, 'wasup_$1_[redacted]');
}

async function recordNotification(input: OrgNotificationInput & {
  recipient: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  provider?: string;
  error?: string | null;
}) {
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase
    .from('notification_events')
    .insert({
      org_id: input.orgId,
      event_type: input.eventType,
      recipient: input.recipient,
      subject: input.subject,
      status: input.status,
      provider: input.provider || 'smtp',
      idempotency_key: input.idempotencyKey,
      error: input.error ?? null,
      metadata: input.metadata ?? {},
      sent_at: input.status === 'sent' ? new Date().toISOString() : null
    })
    .select('id')
    .single();

  if (error?.code === '23505') return { id: '', duplicate: true };
  if (error) throw new Error(error.message);
  return { id: data.id as string, duplicate: false };
}

async function updateNotification(id: string, values: Record<string, unknown>) {
  if (!id) return;
  const { error } = await (getSupabaseAdmin() as any)
    .from('notification_events')
    .update(values)
    .eq('id', id);
  if (error) throw new Error(error.message);
}
