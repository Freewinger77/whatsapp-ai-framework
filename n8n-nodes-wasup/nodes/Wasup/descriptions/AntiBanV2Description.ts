import type { INodeProperties } from 'n8n-workflow';
import { instanceIdField } from './common';

export const antiBanV2Operations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['antiBanV2'] } },
		options: [
			{ name: 'Get Status', value: 'getStatus', action: 'Get v2 status', description: 'Full v2 module status and health summary' },
			{ name: 'Get Config', value: 'getConfig', action: 'Get v2 config', description: 'Detailed per-module configuration' },
			{ name: 'Update Config', value: 'updateConfig', action: 'Update v2 config', description: 'Change preset, rate overrides and module flags' },
			{ name: 'Get Health', value: 'getHealth', action: 'Get v2 health', description: 'Compact risk + score' },
			{ name: 'Get Warmup', value: 'getWarmup', action: 'Get warmup state', description: 'Warm-up progress (day x/7)' },
			{ name: 'Pause', value: 'pause', action: 'Pause v2 enforcement', description: 'Emergency pause' },
			{ name: 'Resume', value: 'resume', action: 'Resume v2 enforcement', description: 'Resume after a pause' },
			{ name: 'Reset', value: 'reset', action: 'Reset v2 state', description: 'Reset counters and state files to defaults' },
		],
		default: 'getStatus',
	},
];

export const antiBanV2Fields: INodeProperties[] = [
	instanceIdField('antiBanV2'),
	{
		displayName: 'Enabled',
		name: 'enabled',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['antiBanV2'], operation: ['updateConfig'] } },
		description: 'Whether to keep Anti-Ban v2 on. Turn off to fall back to the legacy manager.',
	},
	{
		displayName: 'Preset',
		name: 'preset',
		type: 'options',
		default: 'moderate',
		displayOptions: { show: { resource: ['antiBanV2'], operation: ['updateConfig'] } },
		options: [
			{ name: 'Conservative', value: 'conservative' },
			{ name: 'Moderate', value: 'moderate' },
			{ name: 'Aggressive', value: 'aggressive' },
		],
	},
	{
		displayName: 'Rate Overrides',
		name: 'overrides',
		type: 'collection',
		placeholder: 'Add Override',
		default: {},
		displayOptions: { show: { resource: ['antiBanV2'], operation: ['updateConfig'] } },
		description: 'Override individual rate limits and delays',
		options: [
			{ displayName: 'Max Per Minute', name: 'maxPerMinute', type: 'number', default: 12 },
			{ displayName: 'Max Per Hour', name: 'maxPerHour', type: 'number', default: 250 },
			{ displayName: 'Max Per Day', name: 'maxPerDay', type: 'number', default: 4000 },
			{ displayName: 'Min Delay (Ms)', name: 'minDelayMs', type: 'number', default: 1500 },
			{ displayName: 'Max Delay (Ms)', name: 'maxDelayMs', type: 'number', default: 5000 },
		],
	},
	{
		displayName: 'Alerts Webhook',
		name: 'alertsWebhook',
		type: 'string',
		default: '',
		placeholder: 'https://hooks.example.com/...',
		displayOptions: { show: { resource: ['antiBanV2'], operation: ['updateConfig'] } },
		description: 'Optional webhook fired on risk transitions (Telegram/Discord-compatible JSON)',
	},
	{
		displayName: 'Modules (JSON)',
		name: 'modules',
		type: 'json',
		default: '{}',
		displayOptions: { show: { resource: ['antiBanV2'], operation: ['updateConfig'] } },
		description:
			'Optional per-module enable/disable flags, e.g. { "warmup": { "enabled": true }, "presence": { "enabled": true, "circadianProfile": "nightOwl" } }',
	},
];
