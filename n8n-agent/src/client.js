import { sanitizeWorkflowWrite } from './sanitize.js';

export class N8nApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, method: string, path: string, body?: unknown }} details
   */
  constructor(message, details) {
    super(message);
    this.name = 'N8nApiError';
    this.status = details.status;
    this.method = details.method;
    this.path = details.path;
    this.body = details.body;
  }
}

export class N8nClient {
  /**
   * @param {{ baseUrl: string, apiKey: string, fetchImpl?: typeof fetch }} options
   */
  constructor({ baseUrl, apiKey, fetchImpl }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('fetch is not available');
    }
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ query?: Record<string, string|number|boolean|undefined>, body?: unknown }} [options]
   */
  async request(method, path, options = {}) {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    /** @type {Record<string, string>} */
    const headers = {
      accept: 'application/json',
      'X-N8N-API-KEY': this.apiKey,
    };
    /** @type {RequestInit} */
    const init = { method, headers };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(url, init);
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const apiMessage =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed.message || parsed.error || JSON.stringify(parsed)
          : text || response.statusText;
      throw new N8nApiError(`${method} ${path} failed (${response.status}): ${apiMessage}`, {
        status: response.status,
        method,
        path,
        body: parsed,
      });
    }

    return parsed;
  }

  async health() {
    const url = `${this.baseUrl}/healthz`;
    const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    const text = await response.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw
    }
    if (!response.ok) {
      throw new N8nApiError(`GET /healthz failed (${response.status})`, {
        status: response.status,
        method: 'GET',
        path: '/healthz',
        body: parsed,
      });
    }
    return parsed;
  }

  /**
   * @param {string} path
   * @param {Record<string, string|number|boolean|undefined>} [query]
   */
  async listAll(path, query = {}) {
    const items = [];
    let cursor = query.cursor;
    do {
      const page = await this.request('GET', path, {
        query: { ...query, cursor, limit: query.limit || 100 },
      });
      const rows = Array.isArray(page) ? page : page?.data || [];
      items.push(...rows);
      cursor = Array.isArray(page) ? undefined : page?.nextCursor;
    } while (cursor);
    return items;
  }

  /**
   * @param {{ active?: boolean, name?: string, projectId?: string, tags?: string }} [filters]
   */
  listWorkflows(filters = {}) {
    return this.listAll('/workflows', {
      active: filters.active,
      name: filters.name,
      projectId: filters.projectId,
      tags: filters.tags,
    });
  }

  /** @param {string} id */
  getWorkflow(id) {
    return this.request('GET', `/workflows/${encodeURIComponent(id)}`);
  }

  /** @param {Record<string, unknown>} workflow */
  createWorkflow(workflow) {
    return this.request('POST', '/workflows', { body: sanitizeWorkflowWrite(workflow) });
  }

  /**
   * @param {string} id
   * @param {Record<string, unknown>} workflow
   */
  async updateWorkflow(id, workflow) {
    const body = sanitizeWorkflowWrite(workflow);
    try {
      return await this.request('PUT', `/workflows/${encodeURIComponent(id)}`, { body });
    } catch (error) {
      if (error instanceof N8nApiError && (error.status === 404 || error.status === 405)) {
        return this.request('PATCH', `/workflows/${encodeURIComponent(id)}`, { body });
      }
      throw error;
    }
  }

  /** @param {string} id */
  activateWorkflow(id) {
    return this.request('POST', `/workflows/${encodeURIComponent(id)}/activate`);
  }

  /** @param {string} id */
  deactivateWorkflow(id) {
    return this.request('POST', `/workflows/${encodeURIComponent(id)}/deactivate`);
  }

  /** @param {string} id */
  archiveWorkflow(id) {
    return this.request('POST', `/workflows/${encodeURIComponent(id)}/archive`);
  }

  /** @param {string} id */
  unarchiveWorkflow(id) {
    return this.request('POST', `/workflows/${encodeURIComponent(id)}/unarchive`);
  }

  /** @param {string} id */
  async deleteWorkflow(id) {
    try {
      return await this.request('DELETE', `/workflows/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof N8nApiError && error.status === 400) {
        return this.archiveWorkflow(id);
      }
      throw error;
    }
  }

  /**
   * @param {{ workflowId?: string, status?: string, limit?: number }} [filters]
   */
  listExecutions(filters = {}) {
    return this.listAll('/executions', {
      workflowId: filters.workflowId,
      status: filters.status,
      limit: filters.limit || 50,
    });
  }

  /** @param {string} id */
  getExecution(id) {
    return this.request('GET', `/executions/${encodeURIComponent(id)}`);
  }

  listTags() {
    return this.listAll('/tags');
  }
}

/**
 * @param {{ baseUrl: string, apiKey: string, fetchImpl?: typeof fetch }} options
 */
export function createClient(options) {
  return new N8nClient(options);
}
