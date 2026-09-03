#!/usr/bin/env node
/**
 * Salvage Bashir's connected worker instance and clean orphan wa_* rows.
 *
 * Usage:
 *   WASUP_WORKER_SHARED_SECRET=... node scripts/salvage-bashir-workspace.mjs
 *
 * With control-plane link API deployed:
 *   USE_LINK_API=1 WASUP_WORKER_SHARED_SECRET=... node scripts/salvage-bashir-workspace.mjs
 */

const SECRET = process.env.WASUP_WORKER_SHARED_SECRET || '';
const CONTROL_PLANE = (process.env.WASUP_CONTROL_PLANE_URL || 'https://control-plane.wasup.co').replace(/\/+$/, '');
const WORKER = 'https://bashir-s-workspace-hlzpr2.wasup.co';
const ORG_ID = 'adb64f75-77ed-47ec-a2d1-7c961ad77029';
const CP_INSTANCE_ID = '51981fe4-d0f6-4801-8060-750deb57fc72';
const LIVE_WORKER_ID = 'wa_mqao890k_sja4i';

if (!SECRET) {
  console.error('WASUP_WORKER_SHARED_SECRET is required');
  process.exit(1);
}

const workerHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SECRET}`,
  'X-Wasup-Worker-Secret': SECRET,
  'X-API-Key': SECRET
};

async function workerFetch(path, init = {}) {
  const response = await fetch(`${WORKER}${path}`, {
    ...init,
    headers: { ...workerHeaders, ...(init.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function controlPlaneFetch(path, init = {}) {
  const response = await fetch(`${CONTROL_PLANE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Wasup-Worker-Secret': SECRET,
      Authorization: `Bearer ${SECRET}`,
      ...(init.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  console.log('Listing worker instances...');
  const { body: listBody } = await workerFetch('/api/instances');
  const instances = listBody.instances || [];
  console.log(`Worker has ${instances.length} instance(s), ${instances.filter((i) => i.status === 'connected').length} connected.`);

  const live = instances.find((item) => item.id === LIVE_WORKER_ID);
  if (!live) {
    console.error(`Expected live worker instance ${LIVE_WORKER_ID} not found.`);
    process.exit(1);
  }

  if (process.env.USE_LINK_API === '1') {
    console.log('Linking via control-plane /api/internal/instances/link ...');
    const { response, body } = await controlPlaneFetch('/api/internal/instances/link', {
      method: 'POST',
      body: JSON.stringify({
        orgId: ORG_ID,
        controlPlaneInstanceId: CP_INSTANCE_ID,
        workerInstanceId: LIVE_WORKER_ID,
        renameOnWorker: true,
        cleanupOrphanWorkers: true
      })
    });
    console.log(response.status, JSON.stringify(body, null, 2));
    if (!response.ok) process.exit(1);
    return;
  }

  console.log(`Migrating worker instance ${LIVE_WORKER_ID} -> ${CP_INSTANCE_ID} ...`);
  const { response: migrateResponse, body: migrateBody } = await workerFetch(
    `/api/instances/${encodeURIComponent(LIVE_WORKER_ID)}/migrate-id`,
    {
      method: 'POST',
      body: JSON.stringify({ newId: CP_INSTANCE_ID })
    }
  );

  if (!migrateResponse.ok) {
    console.warn('migrate-id failed, continuing with legacy link only:', migrateBody);
  } else {
    console.log('migrate-id ok:', migrateBody.instance?.status, migrateBody.instance?.connectedPhone);
  }

  console.log('Running worker sync on control plane (if deployed)...');
  const { response: syncResponse, body: syncBody } = await controlPlaneFetch('/api/internal/instances/sync', {
    method: 'POST',
    body: JSON.stringify({
      orgId: ORG_ID,
      cleanupOrphanWorkers: true,
      importOrphanWorkers: false,
      linkSuggestions: migrateResponse.ok
        ? []
        : [{ controlPlaneInstanceId: CP_INSTANCE_ID, workerInstanceId: LIVE_WORKER_ID }]
    })
  });
  console.log('sync:', syncResponse.status, JSON.stringify(syncBody, null, 2));

  console.log('Cleaning disconnected orphan wa_* instances...');
  const { body: afterListBody } = await workerFetch('/api/instances');
  for (const item of afterListBody.instances || []) {
    if (item.id === CP_INSTANCE_ID) continue;
    if (item.status === 'connected' || item.status === 'connecting') {
      console.log(`Keeping active instance ${item.id} (${item.status})`);
      continue;
    }
    if (!String(item.id).startsWith('wa_')) {
      console.log(`Skipping non-legacy id ${item.id}`);
      continue;
    }
    const { response, body } = await workerFetch(`/api/instances/${encodeURIComponent(item.id)}`, {
      method: 'DELETE'
    });
    console.log(`DELETE ${item.id}:`, response.status, body.message || body.error || 'ok');
  }

  const { body: finalBody } = await workerFetch('/api/instances');
  console.log('Final worker state:');
  for (const item of finalBody.instances || []) {
    console.log(`- ${item.id} | ${item.status} | ${item.connectedPhone || item.name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
