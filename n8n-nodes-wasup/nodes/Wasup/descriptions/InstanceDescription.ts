import type { INodeProperties } from 'n8n-workflow';
import { instanceIdField } from './common';

export const instanceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['instance'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create an instance',
				description: 'Create a new empty instance (not yet linked to a number)',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete an instance',
				description: 'Permanently remove an instance and its credentials, logs and media',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get an instance',
				description: 'Fetch full details for one instance',
			},
			{
				name: 'List',
				value: 'list',
				action: 'List instances',
				description: 'List every instance on this deployment',
			},
			{
				name: 'Onboard',
				value: 'onboard',
				action: 'Onboard a number',
				description: 'Create, configure and start pairing a number in one call',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update an instance',
				description: 'Update name, webhook, behavior and anti-ban settings',
			},
		],
		default: 'list',
	},
];

export const instanceFields: INodeProperties[] = [
	instanceIdField('instance', ['get', 'update', 'delete']),

	// ---- Create ----
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['instance'], operation: ['create'] } },
		options: [
			{
				displayName: 'Custom Instance ID',
				name: 'id',
				type: 'string',
				default: '',
				description: 'Custom instance ID (auto-generated if omitted)',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Display name for the instance',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				placeholder: 'https://your-api.com/webhook',
				description: 'URL to forward inbound messages to',
			},
		],
	},

	// ---- Onboard ----
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		required: true,
		default: '',
		placeholder: '447393002183',
		displayOptions: { show: { resource: ['instance'], operation: ['onboard'] } },
		description: 'Phone number with country code (+ prefix optional)',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['instance'], operation: ['onboard'] } },
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Friendly name for the instance',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				placeholder: 'https://acme.com/webhook',
			},
			{
				displayName: 'Profile Name',
				name: 'profileName',
				type: 'string',
				default: '',
				description: 'WhatsApp display name (applied once connected)',
			},
			{
				displayName: 'Profile Status (About)',
				name: 'profileStatus',
				type: 'string',
				default: '',
				description: 'WhatsApp "About" text (applied once connected)',
			},
			{
				displayName: 'Behavior Profile',
				name: 'behaviorProfile',
				type: 'options',
				default: 'bot-native',
				options: [
					{ name: 'Bot Native', value: 'bot-native' },
					{ name: 'Notification Balanced', value: 'notification-balanced' },
					{ name: 'Notification Max', value: 'notification-max' },
				],
				description: 'Applied at onboarding time via behaviorSettings',
			},
		],
	},

	// ---- Update ----
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['instance'], operation: ['update'] } },
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				placeholder: 'https://new-webhook.com/endpoint',
			},
			{
				displayName: 'Behavior Profile',
				name: 'behaviorProfile',
				type: 'options',
				default: 'bot-native',
				options: [
					{ name: 'Bot Native', value: 'bot-native' },
					{ name: 'Notification Balanced', value: 'notification-balanced' },
					{ name: 'Notification Max', value: 'notification-max' },
				],
			},
			{
				displayName: 'Anti-Ban Preset',
				name: 'antiBanPreset',
				type: 'options',
				default: 'balanced',
				options: [
					{ name: 'Conservative', value: 'conservative' },
					{ name: 'Balanced', value: 'balanced' },
					{ name: 'Aggressive', value: 'aggressive' },
				],
			},
		],
	},
];
