import type { INodeProperties } from 'n8n-workflow';
import { instanceIdField } from './common';

export const mediaOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['media'] } },
		options: [
			{ name: 'List', value: 'list', action: 'List stored media', description: 'List media stored for an instance' },
			{ name: 'Get', value: 'get', action: 'Get media metadata', description: 'Get a stored media item by id' },
		],
		default: 'list',
	},
];

export const mediaFields: INodeProperties[] = [
	instanceIdField('media'),
	{
		displayName: 'Media ID',
		name: 'mediaId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['media'], operation: ['get'] } },
		description: 'The media id (from an inbound webhook or the media list)',
	},
];
