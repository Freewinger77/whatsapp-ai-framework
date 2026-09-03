#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { createClient, N8nApiError } from './client.js';
import { summarizeWorkflow } from './sanitize.js';

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printTable(rows) {
  if (!rows.length) {
    process.stdout.write('(none)\n');
    return;
  }
  const keys = Object.keys(rows[0]);
  const widths = keys.map((key) =>
    Math.max(key.length, ...rows.map((row) => String(row[key] ?? '').length))
  );
  const line = (values) =>
    values.map((value, index) => String(value ?? '').padEnd(widths[index])).join('  ');
  process.stdout.write(`${line(keys)}\n`);
  process.stdout.write(`${line(widths.map((width) => '-'.repeat(width)))}\n`);
  for (const row of rows) {
    process.stdout.write(`${line(keys.map((key) => row[key]))}\n`);
  }
}

function usage() {
  return `n8n-agent — manage the live n8n Public API

Usage:
  node n8n-agent/src/cli.js <command> [options]

Commands:
  health
  workflows list [--active true|false] [--search <text>] [--json]
  workflows get <id>
  workflows export <id> [--out <file.json>]
  workflows create --file <file.json>
  workflows update <id> --file <file.json>
  workflows activate <id>
  workflows deactivate <id>
  workflows archive <id>
  workflows unarchive <id>
  workflows delete <id>
  executions list [--workflow <id>] [--status success|error|waiting] [--json]
  executions get <id>
  tags list [--json]

Env:
  N8N_BASE_URL   n8n origin, no /api/v1 suffix
  N8N_API_KEY    Public API key (X-N8N-API-KEY)

Also reads n8n-agent/.env and repo-root .env. Never commit the key.
`;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function hasFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

async function main(argv) {
  const args = argv.slice(2);
  const command = args.shift();
  if (!command || command === '-h' || command === '--help') {
    process.stdout.write(usage());
    return 0;
  }

  const client = createClient(loadConfig());

  if (command === 'health') {
    printJson(await client.health());
    return 0;
  }

  if (command === 'workflows') {
    const action = args.shift();
    if (action === 'list') {
      const asJson = hasFlag(args, '--json');
      const activeRaw = takeFlag(args, '--active');
      const search = takeFlag(args, '--search') || args[0];
      const active =
        activeRaw === undefined ? undefined : activeRaw === 'true' || activeRaw === '1';
      let workflows = await client.listWorkflows({ active });
      if (search) {
        const needle = search.toLowerCase();
        workflows = workflows.filter((workflow) =>
          String(workflow.name || '').toLowerCase().includes(needle)
        );
      }
      const rows = workflows.map(summarizeWorkflow);
      if (asJson) printJson(rows);
      else {
        process.stdout.write(`${rows.length} workflows\n`);
        printTable(
          rows.map((row) => ({
            id: row.id,
            active: row.active ? 'on' : 'off',
            archived: row.archived ? 'yes' : '',
            name: row.name,
          }))
        );
      }
      return 0;
    }

    if (action === 'get') {
      const id = args[0];
      if (!id) throw new Error('workflows get <id> is required');
      printJson(await client.getWorkflow(id));
      return 0;
    }

    if (action === 'export') {
      const id = args[0];
      if (!id) throw new Error('workflows export <id> is required');
      const out = takeFlag(args, '--out') || `n8n-workflows/${id}.json`;
      const workflow = await client.getWorkflow(id);
      const dest = resolve(out);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, `${JSON.stringify(workflow, null, 2)}\n`);
      process.stdout.write(`Wrote ${dest}\n`);
      return 0;
    }

    if (action === 'create') {
      const file = takeFlag(args, '--file');
      if (!file) throw new Error('workflows create --file <file.json> is required');
      printJson(await client.createWorkflow(readJsonFile(file)));
      return 0;
    }

    if (action === 'update') {
      const id = args.shift();
      const file = takeFlag(args, '--file');
      if (!id || !file) throw new Error('workflows update <id> --file <file.json> is required');
      printJson(await client.updateWorkflow(id, readJsonFile(file)));
      return 0;
    }

    if (action === 'activate' || action === 'deactivate' || action === 'archive' || action === 'unarchive' || action === 'delete') {
      const id = args[0];
      if (!id) throw new Error(`workflows ${action} <id> is required`);
      const method = {
        activate: 'activateWorkflow',
        deactivate: 'deactivateWorkflow',
        archive: 'archiveWorkflow',
        unarchive: 'unarchiveWorkflow',
        delete: 'deleteWorkflow',
      }[action];
      printJson(await client[method](id));
      return 0;
    }

    throw new Error(`Unknown workflows action: ${action || '(missing)'}`);
  }

  if (command === 'executions') {
    const action = args.shift();
    if (action === 'list') {
      const asJson = hasFlag(args, '--json');
      const workflowId = takeFlag(args, '--workflow');
      const status = takeFlag(args, '--status');
      const executions = await client.listExecutions({ workflowId, status });
      const rows = executions.map((execution) => ({
        id: execution.id,
        status: execution.status,
        workflowId: execution.workflowId,
        startedAt: execution.startedAt,
      }));
      if (asJson) printJson(rows);
      else printTable(rows);
      return 0;
    }

    if (action === 'get') {
      const id = args[0];
      if (!id) throw new Error('executions get <id> is required');
      printJson(await client.getExecution(id));
      return 0;
    }

    throw new Error(`Unknown executions action: ${action || '(missing)'}`);
  }

  if (command === 'tags') {
    const action = args.shift();
    if (action !== 'list') throw new Error('tags list is the only supported tags command');
    const asJson = hasFlag(args, '--json');
    const tags = await client.listTags();
    if (asJson) printJson(tags);
    else printTable(tags.map((tag) => ({ id: tag.id, name: tag.name })));
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

main(process.argv)
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((error) => {
    if (error instanceof N8nApiError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`${error.message || error}\n`);
    }
    process.exitCode = 1;
  });
