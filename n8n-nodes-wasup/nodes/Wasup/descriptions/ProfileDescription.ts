import type { INodeProperties } from 'n8n-workflow';
import { instanceIdField } from './common';

export const profileOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['profile'] } },
		options: [
			{ name: 'Get', value: 'get', action: 'Get profile info', description: 'Read profile metadata' },
			{ name: 'Set Name', value: 'setName', action: 'Set display name', description: 'Change the WhatsApp display name' },
			{ name: 'Set Status (About)', value: 'setStatus', action: 'Set about text', description: 'Update the About / status line' },
			{ name: 'Set Picture', value: 'setPicture', action: 'Set profile picture', description: 'Upload or replace the profile photo' },
			{ name: 'Remove Picture', value: 'removePicture', action: 'Remove profile picture', description: 'Revert to the default avatar' },
		],
		default: 'get',
	},
];

export const profileFields: INodeProperties[] = [
	instanceIdField('profile'),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'Acme Support',
		displayOptions: { show: { resource: ['profile'], operation: ['setName'] } },
	},
	{
		displayName: 'Status (About)',
		name: 'status',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'We reply within minutes!',
		displayOptions: { show: { resource: ['profile'], operation: ['setStatus'] } },
	},
	{
		displayName: 'Image URL',
		name: 'imageUrl',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com/logo.png',
		displayOptions: { show: { resource: ['profile'], operation: ['setPicture'] } },
	},
];
