import type { INodeProperties } from 'n8n-workflow';
import { instanceIdField } from './common';

export const webhookOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['webhook'] } },
		options: [
			{ name: 'Get Global Default', value: 'getGlobal', action: 'Get global webhook', description: 'Read the deployment-wide default webhook URL' },
			{ name: 'Get Instance Webhook', value: 'get', action: 'Get instance webhook', description: 'See which webhook receives inbound messages' },
			{ name: 'Set Instance Webhook', value: 'set', action: 'Set instance webhook', description: 'Set or clear the per-instance webhook URL' },
			{ name: 'Test Delivery', value: 'test', action: 'Test webhook', description: 'Send a sample inbound payload to the webhook' },
		],
		default: 'get',
	},
];

export const webhookFields: INodeProperties[] = [
	instanceIdField('webhook', ['get', 'set', 'test']),
	{
		displayName: 'Webhook URL',
		name: 'webhookUrl',
		type: 'string',
		default: '',
		placeholder: 'https://your-api.com/webhook/instance-1',
		displayOptions: { show: { resource: ['webhook'], operation: ['set'] } },
		description: 'URL to receive inbound message events. Leave empty to fall back to the global default.',
	},
];
