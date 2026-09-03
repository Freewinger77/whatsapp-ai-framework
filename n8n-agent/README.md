# n8n Cloud Agent

CLI and Node client for the live n8n Public API. Cursor cloud agents use this to list, export, create, and update workflows without pasting API keys into chat.

Live host: `https://n8n-rapid-czbff9cnafhkhmhf.eastus-01.azurewebsites.net`

## Setup

```bash
cp n8n-agent/.env.example n8n-agent/.env
# set N8N_API_KEY — never commit this file
```

Or export `N8N_BASE_URL` and `N8N_API_KEY`. On Cursor Cloud Agents, add those same names as environment secrets.

## Commands

```bash
node n8n-agent/src/cli.js health
node n8n-agent/src/cli.js workflows list
node n8n-agent/src/cli.js workflows list --active true --search "TyreFlow"
node n8n-agent/src/cli.js workflows get <id>
node n8n-agent/src/cli.js workflows export <id> --out n8n-workflows/<name>.json
node n8n-agent/src/cli.js workflows update <id> --file n8n-workflows/<name>.json
node n8n-agent/src/cli.js workflows create --file path/to/new-workflow.json
node n8n-agent/src/cli.js workflows activate <id>
node n8n-agent/src/cli.js workflows deactivate <id>
node n8n-agent/src/cli.js executions list --workflow <id>
node n8n-agent/src/cli.js tags list
```

## Safety

- Export a workflow before changing it.
- Do not activate or delete a live workflow unless the user asked.
- Prefer an inactive copy for experiments.
- Never print or commit `N8N_API_KEY`.

## Tests

```bash
node --test n8n-agent/test/*.test.js
```
