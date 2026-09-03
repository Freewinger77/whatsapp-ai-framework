import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickSettings, sanitizeWorkflowWrite, summarizeWorkflow } from '../src/sanitize.js';
import { createClient, N8nApiError } from '../src/client.js';
import { parseEnvFile } from '../src/config.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('sanitizeWorkflowWrite', () => {
  it('drops read-only GET fields and keeps writable ones', () => {
    const body = sanitizeWorkflowWrite({
      id: 'abc',
      name: '  Demo  ',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      versionId: 'v1',
      nodes: [{ id: 'n1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
      connections: {},
      settings: { executionOrder: 'v1', timezone: 'UTC', extraUnsupported: true },
      tags: [{ id: 'tag-1', name: 'frontend' }, 'tag-2'],
      staticData: null,
      description: 'hello',
    });

    assert.equal(body.name, 'Demo');
    assert.deepEqual(body.settings, { executionOrder: 'v1', timezone: 'UTC' });
    assert.equal('tags' in body, false);
    assert.equal(body.description, 'hello');
    const withoutDescription = sanitizeWorkflowWrite({
      name: 'Demo',
      nodes: body.nodes,
      connections: {},
      description: null,
      staticData: null,
      pinData: null,
      meta: null,
    });
    assert.equal('description' in withoutDescription, false);
    assert.equal('staticData' in withoutDescription, false);
    assert.equal('id' in body, false);
    assert.equal('active' in body, false);
    assert.equal('versionId' in body, false);
  });

  it('requires a name and nodes', () => {
    assert.throws(() => sanitizeWorkflowWrite({ nodes: [] }), /name/);
    assert.throws(() => sanitizeWorkflowWrite({ name: 'x' }), /nodes/);
  });
});

describe('pickSettings', () => {
  it('defaults executionOrder', () => {
    assert.deepEqual(pickSettings(null), { executionOrder: 'v1' });
  });
});

describe('summarizeWorkflow', () => {
  it('maps list fields', () => {
    assert.deepEqual(
      summarizeWorkflow({
        id: '1',
        name: 'A',
        active: 1,
        isArchived: false,
        updatedAt: 't',
        triggerCount: 2,
      }),
      { id: '1', name: 'A', active: true, archived: false, updatedAt: 't', triggerCount: 2 }
    );
  });
});

describe('parseEnvFile', () => {
  it('reads KEY=value and ignores comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'n8n-agent-'));
    const path = join(dir, '.env');
    writeFileSync(path, '# comment\nN8N_BASE_URL=https://example.test\nN8N_API_KEY="abc"\n');
    assert.deepEqual(parseEnvFile(path), {
      N8N_BASE_URL: 'https://example.test',
      N8N_API_KEY: 'abc',
    });
  });
});

describe('N8nClient', () => {
  it('lists every workflow page', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      const parsed = new URL(url);
      if (!parsed.searchParams.get('cursor')) {
        return new Response(JSON.stringify({ data: [{ id: 'a', name: 'One' }], nextCursor: 'c2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [{ id: 'b', name: 'Two' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = createClient({
      baseUrl: 'https://n8n.example',
      apiKey: 'test-key',
      fetchImpl,
    });
    const workflows = await client.listWorkflows();
    assert.deepEqual(workflows.map((row) => row.id), ['a', 'b']);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /\/api\/v1\/workflows/);
  });

  it('sends the API key header and surfaces API errors', async () => {
    const fetchImpl = async (url, init) => {
      assert.equal(init.headers['X-N8N-API-KEY'], 'secret');
      return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
    };
    const client = createClient({
      baseUrl: 'https://n8n.example/',
      apiKey: 'secret',
      fetchImpl,
    });
    await assert.rejects(() => client.getWorkflow('abc'), (error) => {
      assert.ok(error instanceof N8nApiError);
      assert.equal(error.status, 401);
      return true;
    });
  });

  it('falls back from PUT to PATCH on 405', async () => {
    const methods = [];
    const fetchImpl = async (url, init) => {
      methods.push(init.method);
      if (init.method === 'PUT') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return new Response(JSON.stringify({ id: 'wf1', name: 'Renamed' }), { status: 200 });
    };
    const client = createClient({
      baseUrl: 'https://n8n.example',
      apiKey: 'k',
      fetchImpl,
    });
    const result = await client.updateWorkflow('wf1', {
      name: 'Renamed',
      nodes: [{ id: 'n1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
      connections: {},
    });
    assert.equal(result.name, 'Renamed');
    assert.deepEqual(methods, ['PUT', 'PATCH']);
  });
});
