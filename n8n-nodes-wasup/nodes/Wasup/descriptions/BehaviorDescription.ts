import type { INodeProperties } from 'n8n-workflow';
import { instanceIdField } from './common';

export const behaviorOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['behavior'] } },
		options: [
			{ name: 'Get', value: 'get', action: 'Get behavior settings', description: 'Read typing, delay and notification settings' },
			{ name: 'Update', value: 'update', action: 'Update behavior settings', description: 'Change how human-like the instance behaves' },
		],
		default: 'get',
	},
];

export const behaviorFields: INodeProperties[] = [
	instanceIdField('behavior'),
	{
		displayName: 'Behavior Profile',
		name: 'behaviorProfile',
		type: 'options',
		default: 'bot-native',
		displayOptions: { show: { resource: ['behavior'], operation: ['update'] } },
		options: [
			{ name: 'Bot Native', value: 'bot-native', description: 'Typing, reads, delays and presence cycling' },
			{ name: 'Notification Balanced', value: 'notification-balanced', description: 'Prioritise handset alerts; webhook still immediate' },
			{ name: 'Notification Max', value: 'notification-max', description: 'Max handset alerts; typing off, no auto reads' },
		],
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['behavior'], operation: ['update'] } },
		options: [
			{ displayName: 'Typing Simulation', name: 'typingSimulation', type: 'boolean', default: true },
			{ displayName: 'Human Delay', name: 'delayEnabled', type: 'boolean', default: true },
			{
				displayName: 'Webhook Typing Events',
				name: 'webhookTypingEvents',
				type: 'boolean',
				default: false,
				description: 'Forward contact composing/recording/paused to the instance webhook (for hold/cancel AI replies)',
			},
			{
				displayName: 'Group Alert Mode',
				name: 'groupAlertMode',
				type: 'boolean',
				default: false,
				description: 'Keep webhooks flowing for multi-group alert numbers; groups never arm handoff maps',
			},
			{
				displayName: 'Proactive tctoken Capture',
				name: 'proactiveTcTokenCapture',
				type: 'boolean',
				default: false,
				description: 'Store privacy tokens from inbound messages (Baileys #2752). Helps warm replies avoid 463; does not mint tokens for cold outbound',
			},
			{
				displayName: 'Notification Grace (Ms)',
				name: 'notificationGraceMs',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 120000 },
				default: 12000,
				description: 'Delay before read receipt / typing / reply in notification profiles',
			},
		],
	},
];
