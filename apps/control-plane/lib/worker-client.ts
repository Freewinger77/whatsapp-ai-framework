import type { ProxyClaimResult } from './proxy-pool';

type CreateWorkerInstanceInput = {
  endpoint: string | null;
  publicIp?: string | null;
  sharedSecret: string | null;
  instance: {
    id: string;
    name: string;
    webhook_url: string | null;
    webhook_signing_secret?: string | null;
    behavior_profile: string;
  };
  proxy: ProxyClaimResult;
};

type WorkerRequestInput = {
  endpoint: string | null;
  publicIp?: string | null;
  sharedSecret: string | null;
  instanceId: string;
};

export type WorkerHealthCheckResult = {
  reachable: boolean;
  status?: number;
  endpoint?: string;
  body?: unknown;
  error?: string;
};

export async function createWorkerInstance(input: CreateWorkerInstanceInput) {
  if (!input.endpoint || !input.sharedSecret) {
    return {
      attempted: false,
      reason: 'deployment_not_ready'
    };
  }

  const response = await requestWorker(input, '/api/instances', {
    method: 'POST',
    body: {
      id: input.instance.id,
      name: input.instance.name,
      webhookUrl: input.instance.webhook_url,
      webhookSigningSecret: input.instance.webhook_signing_secret || '',
      behaviorSettings: {
        behaviorProfile: input.instance.behavior_profile
      },
      proxy: input.proxy.assigned
        ? {
            source: input.proxy.source,
            type: input.proxy.proxy_type,
            host: input.proxy.host,
            port: input.proxy.port,
            username: input.proxy.username_encrypted,
            password: input.proxy.password_encrypted,
            usernameRef: input.proxy.username_ref,
            passwordSecretRef: input.proxy.password_secret_ref,
            credentialSecretRef: input.proxy.credential_secret_ref
          }
        : null
    }
  });

  const body = await safeJson(response);
  if (response.status === 409) {
    return {
      attempted: true,
      alreadyExists: true,
      result: body
    };
  }

  if (!response.ok) {
    throw new Error(`Worker instance create failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return {
    attempted: true,
    result: body
  };
}

export async function updateWorkerInstance(input: WorkerRequestInput, body: unknown) {
  const response = await requestWorker(input, `/api/instances/${encodeURIComponent(input.instanceId)}`, {
    method: 'PUT',
    body
  });
  return parseWorkerResponse(response, 'Worker instance update failed');
}

export async function checkWorkerHealth(input: Pick<WorkerRequestInput, 'endpoint' | 'publicIp' | 'sharedSecret'>): Promise<WorkerHealthCheckResult> {
  if (!input.endpoint || !input.sharedSecret) {
    return { reachable: false, error: 'Worker deployment is not ready yet.' };
  }

  try {
    const response = await requestWorker(input, '/api/health');
    const body = await safeJson(response);
    return {
      reachable: response.ok,
      status: response.status,
      endpoint: response.url,
      body: sanitizeHealthBody(body),
      error: response.ok ? undefined : `Worker health check failed (${response.status})`
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function connectWorkerInstance(input: WorkerRequestInput, options: { pairingPhone?: string } = {}) {
  const response = await requestWorker(input, `/api/instances/${encodeURIComponent(input.instanceId)}/connect`, {
    method: 'POST',
    body: options.pairingPhone ? { pairingPhone: options.pairingPhone } : {}
  });
  const body = await safeJson(response);
  if (response.ok) return body;

  const workerError = typeof body?.error === 'string' ? body.error : '';
  if (response.status === 400 && /Connection in progress|Already connected/i.test(workerError)) {
    return {
      success: true,
      message: workerError,
      instance: { status: /Already connected/i.test(workerError) ? 'connected' : 'connecting' }
    };
  }

  throw new Error(`Worker connect failed (${response.status}): ${JSON.stringify(body)}`);
}

export async function getWorkerInstanceQr(input: WorkerRequestInput) {
  const response = await requestWorker(input, `/api/instances/${encodeURIComponent(input.instanceId)}/qr`);
  return parseWorkerResponse(response, 'Worker QR fetch failed');
}

export async function sendWorkerInstanceMessage(input: WorkerRequestInput, body: unknown) {
  const response = await requestWorker(input, `/api/instances/${encodeURIComponent(input.instanceId)}/send`, {
    method: 'POST',
    body
  });
  return parseWorkerResponse(response, 'Worker send failed');
}

export async function getWorkerInstance(input: WorkerRequestInput) {
  const response = await requestWorker(input, `/api/instances/${encodeURIComponent(input.instanceId)}`);
  const body = await safeJson(response);

  if (response.ok) {
    return {
      found: true as const,
      result: body
    };
  }

  const workerError = typeof body?.error === 'string' ? body.error : '';
  if (response.status === 404 || (response.status === 400 && /not found/i.test(workerError))) {
    return {
      found: false as const,
      result: body
    };
  }

  throw new Error(`Worker instance lookup failed (${response.status}): ${JSON.stringify(body)}`);
}

export async function clearWorkerInstanceAuth(input: WorkerRequestInput) {
  const response = await requestWorker(input, `/api/instances/${encodeURIComponent(input.instanceId)}/clear-auth`, {
    method: 'POST',
    body: {}
  });
  return parseWorkerResponse(response, 'Worker clear auth failed');
}

export async function deleteWorkerInstance(input: WorkerRequestInput) {
  const response = await requestWorker(input, `/api/instances/${encodeURIComponent(input.instanceId)}`, {
    method: 'DELETE'
  });
  const body = await safeJson(response);

  if (response.ok) {
    return {
      attempted: true as const,
      result: body
    };
  }

  const workerError = typeof body?.error === 'string' ? body.error : '';
  if (response.status === 404 || (response.status === 400 && /not found/i.test(workerError))) {
    return {
      attempted: true as const,
      alreadyDeleted: true as const,
      result: body
    };
  }

  throw new Error(`Worker instance delete failed (${response.status}): ${JSON.stringify(body)}`);
}

export async function listWorkerInstanceMedia(
  input: WorkerRequestInput,
  query: { mediaType?: string; limit?: number } = {}
) {
  const search = new URLSearchParams();
  if (query.mediaType) search.set('type', query.mediaType);
  if (query.limit) search.set('limit', String(query.limit));
  const suffix = search.size ? `?${search.toString()}` : '';
  const response = await requestWorker(
    input,
    `/api/instances/${encodeURIComponent(input.instanceId)}/media${suffix}`
  );
  return parseWorkerResponse(response, 'Worker media list failed');
}

export async function fetchWorkerInstanceMedia(input: WorkerRequestInput, mediaId: string) {
  const response = await requestWorker(
    input,
    `/api/instances/${encodeURIComponent(input.instanceId)}/media/${encodeURIComponent(mediaId)}`
  );

  if (!response.ok) {
    const body = await safeJson(response);
    throw new Error(`Worker media fetch failed (${response.status}): ${JSON.stringify(body)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const contentDisposition = response.headers.get('content-disposition') || '';
  const fileNameMatch = contentDisposition.match(/filename="([^"]+)"/i);
  return {
    buffer,
    contentType,
    fileName: fileNameMatch?.[1] || `${mediaId}.bin`
  };
}

async function parseWorkerResponse(response: Response, message: string) {
  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`${message} (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function requestWorker(
  input: Pick<WorkerRequestInput, 'endpoint' | 'publicIp' | 'sharedSecret'>,
  path: string,
  init: { method?: string; body?: unknown } = {}
) {
  if (!input.endpoint || !input.sharedSecret) {
    throw new Error('Worker deployment is not ready yet.');
  }

  const candidates = buildWorkerEndpointCandidates(input.endpoint, input.publicIp);
  const failures: string[] = [];

  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate.url}${path}`, {
        method: init.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.sharedSecret}`,
          'X-API-Key': input.sharedSecret,
          'X-Wasup-Worker-Secret': input.sharedSecret,
          ...(candidate.hostHeader ? { Host: candidate.hostHeader } : {})
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(10_000)
      });
      return response;
    } catch (error) {
      failures.push(`${candidate.label}: ${describeFetchError(error)}`);
    }
  }

  throw new Error(`Worker unreachable after ${failures.length} attempt(s): ${failures.join('; ')}`);
}

function buildWorkerEndpointCandidates(endpoint: string, publicIp?: string | null) {
  const base = endpoint.replace(/\/$/, '');
  const candidates: Array<{ url: string; label: string; hostHeader?: string }> = [{ url: base, label: base }];

  try {
    const url = new URL(base);
    if (url.protocol === 'https:') {
      const httpUrl = new URL(url.toString());
      httpUrl.protocol = 'http:';
      candidates.push({ url: httpUrl.toString().replace(/\/$/, ''), label: httpUrl.toString().replace(/\/$/, '') });
    }

    if (publicIp) {
      candidates.push({
        url: `http://${publicIp}`,
        label: `http://${publicIp} with Host ${url.hostname}`,
        hostHeader: url.hostname
      });
    }
  } catch {
    // The primary endpoint will still surface a useful fetch error.
  }

  return dedupeCandidates(candidates);
}

function dedupeCandidates(candidates: Array<{ url: string; label: string; hostHeader?: string }>) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.url}|${candidate.hostHeader || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeFetchError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; reason?: string } | undefined;
  const detail = [cause?.code, cause?.reason].filter(Boolean).join(' ');
  return detail ? `${error.message} (${detail})` : error.message;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return { text: await response.text() };
  }
}

function sanitizeHealthBody(body: unknown) {
  if (!body || typeof body !== 'object') return body;
  const source = body as Record<string, unknown>;
  return {
    status: source.status,
    uptime: source.uptime,
    instances: source.instances
  };
}
