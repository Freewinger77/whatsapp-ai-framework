import type { INodeProperties } from 'n8n-workflow';
import { instanceIdField } from './common';

export const connectionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['connection'] } },
		options: [
			{
				name: 'Connect',
				value: 'connect',
				action: 'Connect an instance',
				description: 'Start linking the instance (QR mode, or pairing code if a phone is provided)',
			},
			{
				name: 'Disconnect',
				value: 'disconnect',
				action: 'Disconnect an instance',
				description: 'Close the live session locally (credentials are kept unless revoked)',
			},
			{
				name: 'Clear Auth',
				value: 'clearAuth',
				action: 'Clear auth',
				description: 'Wipe saved pairing data — next connect needs a fresh QR/pairing code',
			},
			{
				name: 'Pair',
				value: 'pair',
				action: 'Connect via pairing code',
				description: 'Connect using a numeric pairing code instead of QR',
			},
			{
				name: 'Get QR / Pairing Code',
				value: 'getQr',
				action: 'Get QR or pairing code',
				description: 'Get the current QR image or pairing code',
			},
			{
				name: 'Get Status',
				value: 'getStatus',
				action: 'Get connection status',
				description: 'Lightweight poll of status, phone, uptime and pairing hints',
			},
		],
		default: 'connect',
	},
];

export const connectionFields: INodeProperties[] = [
	instanceIdField('connection'),

	{
		displayName: 'Pairing Phone',
		name: 'pairingPhone',
		type: 'string',
		default: '',
		placeholder: '447393002183',
		displayOptions: { show: { resource: ['connection'], operation: ['connect'] } },
		description:
			'Optional. Phone number with country code (no +). If provided, returns a pairing code instead of QR.',
	},
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: '447393002183',
		displayOptions: { show: { resource: ['connection'], operation: ['pair'] } },
		description: 'Phone number with country code, no + prefix',
	},
	{
		displayName: 'Revoke Session',
		name: 'revoke',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['connection'], operation: ['disconnect'] } },
		description:
			'Whether to revoke the device on WhatsApp servers. Leave off to keep credentials for a clean reconnect.',
	},
	{
		displayName: 'Response Format',
		name: 'qrFormat',
		type: 'options',
		default: 'json',
		displayOptions: { show: { resource: ['connection'], operation: ['getQr'] } },
		options: [
			{ name: 'JSON (Base64 Data URL)', value: 'json' },
			{ name: 'PNG Image (Binary)', value: 'image' },
		],
		description: 'Return the QR as a JSON data URL or as a raw PNG in a binary property',
	},
	{
		displayName: 'Put Output In Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		displayOptions: {
			show: { resource: ['connection'], operation: ['getQr'], qrFormat: ['image'] },
		},
		description: 'Name of the binary property to write the QR PNG into',
	},
];
