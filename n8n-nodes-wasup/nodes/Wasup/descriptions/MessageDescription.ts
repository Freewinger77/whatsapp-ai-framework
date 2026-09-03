import type { INodeProperties } from 'n8n-workflow';

const SEND_OPS = [
	'sendText',
	'sendMedia',
	'sendButtons',
	'sendCta',
	'sendList',
	'sendLocation',
	'sendContact',
];
const SEND_AND_REACT = [...SEND_OPS, 'react'];

export const messageOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['message'] } },
		options: [
			{
				name: 'Send Text',
				value: 'sendText',
				action: 'Send a text message',
				description: 'Plain text, optionally with a link preview',
			},
			{
				name: 'Send Media',
				value: 'sendMedia',
				action: 'Send media',
				description: 'Send an image, video, document or audio by URL',
			},
			{
				name: 'Send Buttons',
				value: 'sendButtons',
				action: 'Send quick-reply buttons',
				description: 'Quick-reply buttons, optionally combined with a CTA URL button (max 3 actions total)',
			},
			{
				name: 'Send CTA URL Button',
				value: 'sendCta',
				action: 'Send a CTA URL button',
				description: 'A call-to-action URL button, optionally combined with quick-reply buttons (max 3 actions total)',
			},
			{
				name: 'Send List',
				value: 'sendList',
				action: 'Send a list message',
				description: 'A single-select list menu with sections and rows',
			},
			{
				name: 'Send Location',
				value: 'sendLocation',
				action: 'Send a location',
				description: 'Share a map location pin',
			},
			{
				name: 'Send Contact',
				value: 'sendContact',
				action: 'Send a contact card',
				description: 'Share a contact (vCard)',
			},
			{
				name: 'React',
				value: 'react',
				action: 'React to a message',
				description: 'Add or remove an emoji reaction',
			},
			{
				name: 'Get Status',
				value: 'getStatus',
				action: 'Get message delivery status',
				description: 'Poll sent / delivered / read status for an outbound message by id',
			},
			{
				name: 'Get History',
				value: 'getHistory',
				action: 'Get message history',
				description: 'Search recent message history stored on the worker',
			},
			{
				name: 'Send Raw',
				value: 'sendRaw',
				action: 'Send a raw payload',
				description: 'Send a fully custom JSON body to the instance send endpoint',
			},
		],
		default: 'sendText',
	},
];

export const messageFields: INodeProperties[] = [
	// Auto-select toggle (sends without specifying an instance id)
	{
		displayName: 'Auto-Select Instance',
		name: 'autoSelect',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['message'], operation: SEND_AND_REACT } },
		description:
			'Whether to let Wasup pick a connected instance automatically (uses /api/send & /api/react) instead of targeting a specific instance',
	},
	{
		displayName: 'From Phone',
		name: 'fromPhone',
		type: 'string',
		default: '',
		placeholder: '60123456789',
		displayOptions: {
			show: { resource: ['message'], operation: SEND_AND_REACT, autoSelect: [true] },
		},
		description: 'Optional connected number to send from when auto-selecting',
	},

	// Instance picker (shown when not auto-selecting, and always for history/raw)
	{
		displayName: 'Instance',
		name: 'instanceId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: {
			show: { resource: ['message'] },
			hide: { autoSelect: [true] },
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchInstances', searchable: true },
			},
			{ displayName: 'By ID', name: 'id', type: 'string', placeholder: 'wa_lxyz123_abc45' },
		],
	},

	// Recipient
	{
		displayName: 'To',
		name: 'to',
		type: 'string',
		required: true,
		default: '',
		placeholder: '60123456789',
		displayOptions: { show: { resource: ['message'], operation: SEND_AND_REACT } },
		description: 'Recipient phone number with country code (no + or spaces), or a chat id',
	},

	// ---- Send Text ----
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		displayOptions: { show: { resource: ['message'], operation: ['sendText'] } },
		description: 'The text body to send',
	},
	{
		displayName: 'Link Preview',
		name: 'linkPreview',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['message'], operation: ['sendText'] } },
		description: 'Whether to render a rich preview card when the text contains a URL',
	},

	// ---- Send Media ----
	{
		displayName: 'Media Type',
		name: 'mediaType',
		type: 'options',
		default: 'image',
		displayOptions: { show: { resource: ['message'], operation: ['sendMedia'] } },
		options: [
			{ name: 'Image', value: 'image' },
			{ name: 'Video', value: 'video' },
			{ name: 'Document', value: 'document' },
			{ name: 'Audio', value: 'audio' },
		],
	},
	{
		displayName: 'Media URL',
		name: 'mediaUrl',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com/photo.jpg',
		displayOptions: { show: { resource: ['message'], operation: ['sendMedia'] } },
		description: 'Direct, publicly reachable URL to the media file',
	},
	{
		displayName: 'Caption',
		name: 'message',
		type: 'string',
		default: '',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendMedia'], mediaType: ['image', 'video', 'document'] },
		},
		description: 'Optional caption shown with the media',
	},
	{
		displayName: 'Media Options',
		name: 'mediaOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['message'], operation: ['sendMedia'] } },
		options: [
			{ displayName: 'File Name', name: 'fileName', type: 'string', default: '', placeholder: 'report.pdf' },
			{ displayName: 'MIME Type', name: 'mimeType', type: 'string', default: '', placeholder: 'application/pdf' },
			{
				displayName: 'Send Audio as Voice Note (PTT)',
				name: 'ptt',
				type: 'boolean',
				default: true,
				description: 'Whether to send audio as a push-to-talk voice note',
			},
		],
	},

	// ---- Send Buttons (quick replies) ----
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 2 },
		required: true,
		default: '',
		displayOptions: { show: { resource: ['message'], operation: ['sendButtons', 'sendCta', 'sendList'] } },
		description: 'The body text shown above the buttons / list',
	},
	{
		displayName: 'Buttons',
		name: 'buttons',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Button',
		displayOptions: { show: { resource: ['message'], operation: ['sendButtons', 'sendCta'] } },
		description:
			'Quick-reply buttons. Combined with a CTA URL button, the total interactive actions must not exceed 3 (e.g. 2 quick replies + 1 CTA).',
		options: [
			{
				name: 'button',
				displayName: 'Button',
				values: [
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						default: '',
						placeholder: 'yes',
						description: 'Value returned in the webhook when tapped',
					},
					{
						displayName: 'Text',
						name: 'text',
						type: 'string',
						default: '',
						placeholder: 'Yes',
						description: 'Button label (max 20 chars)',
					},
				],
			},
		],
	},

	// ---- CTA URL button (available on both sendCta and sendButtons) ----
	{
		displayName: 'CTA URL',
		name: 'ctaUrl',
		type: 'string',
		default: '',
		placeholder: 'https://example.com/book',
		displayOptions: { show: { resource: ['message'], operation: ['sendButtons', 'sendCta'] } },
		description:
			'The URL the call-to-action button opens. Required for "Send CTA URL Button"; optional for "Send Buttons" if you also want a CTA alongside the quick replies.',
	},
	{
		displayName: 'CTA Label',
		name: 'ctaLabel',
		type: 'string',
		default: 'Open',
		placeholder: 'Book now',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendButtons', 'sendCta'] },
			hide: { ctaUrl: [''] },
		},
		description: 'CTA button label (max 25 chars)',
	},

	// ---- Send List ----
	{
		displayName: 'Sections (JSON)',
		name: 'sections',
		type: 'json',
		default:
			'[\n  {\n    "title": "Services",\n    "rows": [\n      { "id": "consulting", "title": "Consulting", "description": "Expert advice" }\n    ]\n  }\n]',
		displayOptions: { show: { resource: ['message'], operation: ['sendList'] } },
		description: 'List sections, each with a title and an array of rows (id, title, description)',
	},
	{
		displayName: 'List Options',
		name: 'listOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['message'], operation: ['sendList'] } },
		options: [
			{ displayName: 'Title', name: 'title', type: 'string', default: '', placeholder: 'Our Services' },
			{
				displayName: 'Button Text',
				name: 'buttonText',
				type: 'string',
				default: 'Menu',
				description: 'Menu button label that opens the list',
			},
		],
	},

	// ---- Send Location ----
	{
		displayName: 'Latitude',
		name: 'latitude',
		type: 'number',
		required: true,
		default: 0,
		typeOptions: { numberPrecision: 6 },
		displayOptions: { show: { resource: ['message'], operation: ['sendLocation'] } },
	},
	{
		displayName: 'Longitude',
		name: 'longitude',
		type: 'number',
		required: true,
		default: 0,
		typeOptions: { numberPrecision: 6 },
		displayOptions: { show: { resource: ['message'], operation: ['sendLocation'] } },
	},
	{
		displayName: 'Location Details',
		name: 'locationOptions',
		type: 'collection',
		placeholder: 'Add Detail',
		default: {},
		displayOptions: { show: { resource: ['message'], operation: ['sendLocation'] } },
		options: [
			{ displayName: 'Name', name: 'locationName', type: 'string', default: '' },
			{ displayName: 'Address', name: 'locationAddress', type: 'string', default: '' },
		],
	},

	// ---- Send Contact ----
	{
		displayName: 'Display Name',
		name: 'displayName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'John Doe',
		displayOptions: { show: { resource: ['message'], operation: ['sendContact'] } },
	},
	{
		displayName: 'Phone Number',
		name: 'contactPhone',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+60123456789',
		displayOptions: { show: { resource: ['message'], operation: ['sendContact'] } },
	},

	// ---- Shared footer + advanced send options ----
	{
		displayName: 'Footer',
		name: 'footer',
		type: 'string',
		default: '',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendButtons', 'sendCta', 'sendList'] },
		},
		description: 'Small footer text shown under buttons / list',
	},
	{
		displayName: 'Advanced Options',
		name: 'advancedOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['message'], operation: SEND_OPS } },
		options: [
			{
				displayName: 'Typing Simulation',
				name: 'typingSimulation',
				type: 'boolean',
				default: true,
				description: 'Whether to show a "typing…" indicator before sending',
			},
			{
				displayName: 'Human Delay',
				name: 'delayEnabled',
				type: 'boolean',
				default: true,
				description: 'Whether to add a human-like delay before sending',
			},
			{
				displayName: 'Skip Contact Save',
				name: 'skipContactSave',
				type: 'boolean',
				default: false,
				description: 'Whether to skip auto-saving the recipient as a contact',
			},
			{
				displayName: 'Contact Name',
				name: 'contactName',
				type: 'string',
				default: '',
				description: 'Name used when auto-saving the recipient as a contact',
			},
		],
	},

	// ---- React ----
	{
		displayName: 'Message ID',
		name: 'messageId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '3EB0DAC5F4A2E1B7',
		displayOptions: { show: { resource: ['message'], operation: ['react', 'getStatus'] } },
		description:
			'The message id from a send response (`message_id`) or an inbound webhook — used to react to it or poll its delivery status',
	},
	{
		displayName: 'Emoji',
		name: 'emoji',
		type: 'string',
		default: '👍',
		displayOptions: { show: { resource: ['message'], operation: ['react'] } },
		description: 'Emoji to react with. Pass an empty string to remove a reaction.',
	},
	{
		displayName: 'From Me',
		name: 'fromMe',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['message'], operation: ['react'] } },
		description: 'Whether the target message was sent by this connected account',
	},

	// ---- Get History ----
	{
		displayName: 'Filters',
		name: 'historyFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['message'], operation: ['getHistory'] } },
		options: [
			{
				displayName: 'Direction',
				name: 'direction',
				type: 'options',
				default: 'inbound',
				options: [
					{ name: 'Inbound', value: 'inbound' },
					{ name: 'Outbound', value: 'outbound' },
				],
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 200 },
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Since',
				name: 'since',
				type: 'dateTime',
				default: '',
				description: 'Only return messages after this timestamp',
			},
		],
	},

	// ---- Send Raw ----
	{
		displayName: 'Body (JSON)',
		name: 'rawBody',
		type: 'json',
		required: true,
		default: '{\n  "to": "60123456789",\n  "message": "Hello from Wasup"\n}',
		displayOptions: { show: { resource: ['message'], operation: ['sendRaw'] } },
		description: 'The exact JSON body to POST to the instance send endpoint',
	},
];
