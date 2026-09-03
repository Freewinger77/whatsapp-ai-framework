import type { INodeProperties } from 'n8n-workflow';
import { instanceIdField } from './common';

export const antiBanOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['antiBan'] } },
		options: [
			{ name: 'Get Status', value: 'get', action: 'Get anti-ban status', description: 'Read legacy limits and current usage' },
			{ name: 'Update', value: 'update', action: 'Update anti-ban settings', description: 'Change legacy rate limits via preset or custom caps' },
		],
		default: 'get',
	},
];

export const antiBanFields: INodeProperties[] = [
	instanceIdField('antiBan'),
	{
		displayName: 'Preset',
		name: 'preset',
		type: 'options',
		default: 'balanced',
		displayOptions: { show: { resource: ['antiBan'], operation: ['update'] } },
		options: [
			{ name: 'New (Conservative)', value: 'new' },
			{ name: 'Balanced', value: 'balanced' },
			{ name: 'Higher', value: 'higher' },
			{ name: 'Custom', value: 'custom' },
		],
	},
	{
		displayName: 'Custom Limits',
		name: 'customLimits',
		type: 'collection',
		placeholder: 'Add Limit',
		default: {},
		displayOptions: { show: { resource: ['antiBan'], operation: ['update'], preset: ['custom'] } },
		options: [
			{ displayName: 'Messages Per Hour', name: 'messagesPerHour', type: 'number', default: 50 },
			{ displayName: 'Messages Per Day', name: 'messagesPerDay', type: 'number', default: 300 },
			{ displayName: 'Unique Chats Per Hour', name: 'uniqueChatsPerHour', type: 'number', default: 25 },
			{ displayName: 'Unique Chats Per Day', name: 'uniqueChatsPerDay', type: 'number', default: 100 },
		],
	},
];
