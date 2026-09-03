import type { INodeProperties } from 'n8n-workflow';
import { instanceIdField } from './common';

export const handoffOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['handoff'] } },
		options: [
			{ name: 'List Active', value: 'list', action: 'List handoff chats', description: 'List chats currently in human-handoff mode' },
			{ name: 'Set', value: 'set', action: 'Set handoff', description: 'Pause or resume the bot for one chat' },
			{ name: 'Clear All', value: 'clearAll', action: 'Clear handoffs', description: 'Clear handoff for all contacts' },
			{ name: 'Get Settings', value: 'getSettings', action: 'Get handoff settings', description: 'Read keywords and resume message' },
			{ name: 'Update Settings', value: 'updateSettings', action: 'Update handoff settings', description: 'Change resume keywords and message' },
		],
		default: 'list',
	},
];

export const handoffFields: INodeProperties[] = [
	instanceIdField('handoff'),
	{
		displayName: 'Phone / Chat ID',
		name: 'phone',
		type: 'string',
		required: true,
		default: '',
		placeholder: '447835156367',
		displayOptions: { show: { resource: ['handoff'], operation: ['set'] } },
	},
	{
		displayName: 'Active',
		name: 'active',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['handoff'], operation: ['set'] } },
		description: 'Whether to pause the bot (true) or resume it (false) for this chat',
	},
	{
		displayName: 'Resume Keywords',
		name: 'resumeKeywords',
		type: 'string',
		default: '#ai,#assistant,#bot,#resume',
		displayOptions: { show: { resource: ['handoff'], operation: ['updateSettings'] } },
		description: 'Comma-separated keywords that resume the AI agent',
	},
	{
		displayName: 'Resume Message',
		name: 'resumeMessage',
		type: 'string',
		default: '',
		displayOptions: { show: { resource: ['handoff'], operation: ['updateSettings'] } },
		description: 'Auto-reply sent when the AI agent resumes. Leave empty for silent resume.',
	},
	{
		displayName: 'Block API Sends During Handoff',
		name: 'blockApiSendsDuringHandoff',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['handoff'], operation: ['updateSettings'] } },
		description:
			'When enabled, /api/send refuses chats in human mode (PN and LID matched). Pass forceDespiteHandoff on a send to override.',
	},
];
