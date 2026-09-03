import type { INodeProperties } from 'n8n-workflow';

export const systemOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['system'] } },
		options: [
			{ name: 'Health', value: 'health', action: 'Health check', description: 'Quick deployment health check (no auth)' },
			{ name: 'Status', value: 'status', action: 'System status', description: 'Authenticated roll-up of all instances' },
			{ name: 'Storage Status', value: 'storageStatus', action: 'Storage status', description: 'Report the media storage backend' },
			{ name: 'Generate API Key', value: 'generateApiKey', action: 'Generate API key', description: 'Generate a random API key string' },
			{ name: 'Reload Behavior From Disk', value: 'reloadBehavior', action: 'Reload behavior', description: 'Hot-reload saved behavior settings without restarting' },
		],
		default: 'health',
	},
];

export const systemFields: INodeProperties[] = [];
