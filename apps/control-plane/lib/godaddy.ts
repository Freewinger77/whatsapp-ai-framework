import { getServerEnv } from './env';

type UpsertDnsRecordInput = {
  subdomain: string;
  value: string;
  ttl?: number;
};

export async function upsertGoDaddyARecord(input: UpsertDnsRecordInput) {
  const env = getServerEnv();
  if (!env.GODADDY_API_KEY || !env.GODADDY_API_SECRET) {
    return { configured: false, skipped: true as const };
  }

  const recordName = input.subdomain.replace(`.${env.GODADDY_DOMAIN}`, '');
  const response = await fetch(
    `https://api.godaddy.com/v1/domains/${env.GODADDY_DOMAIN}/records/A/${encodeURIComponent(recordName)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `sso-key ${env.GODADDY_API_KEY}:${env.GODADDY_API_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        {
          data: input.value,
          ttl: input.ttl ?? 600
        }
      ])
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GoDaddy DNS update failed (${response.status}): ${body}`);
  }

  return { configured: true, skipped: false as const, recordName, value: input.value };
}

export async function deleteGoDaddyARecord(subdomain: string) {
  const env = getServerEnv();
  if (!env.GODADDY_API_KEY || !env.GODADDY_API_SECRET) {
    return { configured: false, skipped: true as const };
  }

  const recordName = subdomain.replace(`.${env.GODADDY_DOMAIN}`, '');
  const response = await fetch(
    `https://api.godaddy.com/v1/domains/${env.GODADDY_DOMAIN}/records/A/${encodeURIComponent(recordName)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `sso-key ${env.GODADDY_API_KEY}:${env.GODADDY_API_SECRET}`
      }
    }
  );

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`GoDaddy DNS delete failed (${response.status}): ${body}`);
  }

  return { configured: true, skipped: false as const, recordName };
}
