const SETTINGS_KEYS = new Set([
  'availableInMCP',
  'callerPolicy',
  'errorWorkflow',
  'executionOrder',
  'executionTimeout',
  'saveDataErrorExecution',
  'saveDataSuccessExecution',
  'saveExecutionProgress',
  'saveManualExecutions',
  'timeSavedPerExecution',
  'timezone',
]);

/**
 * n8n GET responses include read-only fields that PUT/PATCH reject.
 * Keep only fields the Public API accepts for create/update.
 *
 * @param {Record<string, unknown>} input
 */
export function sanitizeWorkflowWrite(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Workflow payload must be an object');
  }

  if (typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error('Workflow name is required');
  }
  if (!Array.isArray(input.nodes)) {
    throw new Error('Workflow nodes[] is required');
  }

  /** @type {Record<string, unknown>} */
  const body = {
    name: input.name.trim(),
    nodes: input.nodes,
    connections: input.connections && typeof input.connections === 'object' ? input.connections : {},
    settings: pickSettings(input.settings),
  };

  if (input.staticData !== undefined && input.staticData !== null) body.staticData = input.staticData;
  if (input.pinData && typeof input.pinData === 'object' && !Array.isArray(input.pinData)) {
    body.pinData = input.pinData;
  }
  if (typeof input.description === 'string' && input.description.length > 0) {
    body.description = input.description;
  }

  return body;
}

/**
 * @param {unknown} settings
 */
export function pickSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { executionOrder: 'v1' };
  }

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(settings)) {
    if (SETTINGS_KEYS.has(key) && value !== undefined) {
      out[key] = value;
    }
  }
  if (!out.executionOrder) out.executionOrder = 'v1';
  return out;
}

/**
 * Compact row for list output.
 *
 * @param {Record<string, unknown>} workflow
 */
export function summarizeWorkflow(workflow) {
  return {
    id: workflow.id,
    name: workflow.name,
    active: Boolean(workflow.active),
    archived: Boolean(workflow.isArchived),
    updatedAt: workflow.updatedAt,
    triggerCount: workflow.triggerCount,
  };
}
