import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { cleanObject, searchInstances, wasupApiRequest } from './GenericFunctions';
import {
	antiBanFields,
	antiBanOperations,
	antiBanV2Fields,
	antiBanV2Operations,
	behaviorFields,
	behaviorOperations,
	connectionFields,
	connectionOperations,
	handoffFields,
	handoffOperations,
	instanceFields,
	instanceOperations,
	mediaFields,
	mediaOperations,
	messageFields,
	messageOperations,
	profileFields,
	profileOperations,
	systemFields,
	systemOperations,
	webhookFields,
	webhookOperations,
} from './descriptions';

function parseJsonParam(value: unknown, fieldName: string): IDataObject | unknown[] {
	if (value === undefined || value === null || value === '') return {};
	if (typeof value === 'object') return value as IDataObject;
	try {
		return JSON.parse(value as string);
	} catch (error) {
		throw new Error(`The "${fieldName}" field is not valid JSON: ${(error as Error).message}`);
	}
}

export class Wasup implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wasup',
		name: 'wasup',
		icon: 'file:wasup.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send WhatsApp messages and manage instances via the Wasup API',
		defaults: { name: 'Wasup' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'wasupApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Message', value: 'message' },
					{ name: 'Instance', value: 'instance' },
					{ name: 'Connection', value: 'connection' },
					{ name: 'Profile', value: 'profile' },
					{ name: 'Behavior', value: 'behavior' },
					{ name: 'Anti-Ban (Legacy)', value: 'antiBan' },
					{ name: 'Anti-Ban V2', value: 'antiBanV2' },
					{ name: 'Handoff', value: 'handoff' },
					{ name: 'Webhook', value: 'webhook' },
					{ name: 'Media', value: 'media' },
					{ name: 'System', value: 'system' },
				],
				default: 'message',
			},
			...instanceOperations,
			...instanceFields,
			...connectionOperations,
			...connectionFields,
			...messageOperations,
			...messageFields,
			...profileOperations,
			...profileFields,
			...behaviorOperations,
			...behaviorFields,
			...antiBanOperations,
			...antiBanFields,
			...antiBanV2Operations,
			...antiBanV2Fields,
			...handoffOperations,
			...handoffFields,
			...webhookOperations,
			...webhookFields,
			...mediaOperations,
			...mediaFields,
			...systemOperations,
			...systemFields,
		],
	};

	methods = {
		listSearch: { searchInstances },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		const getInstanceId = (i: number): string =>
			this.getNodeParameter('instanceId', i, '', { extractValue: true }) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] | undefined;
				const binary: INodeExecutionData['binary'] = {};

				// ----------------------------------------------------------------
				// INSTANCE
				// ----------------------------------------------------------------
				if (resource === 'instance') {
					if (operation === 'list') {
						responseData = await wasupApiRequest.call(this, 'GET', '/api/instances');
					} else if (operation === 'get') {
						responseData = await wasupApiRequest.call(this, 'GET', `/api/instances/${getInstanceId(i)}`);
					} else if (operation === 'delete') {
						responseData = await wasupApiRequest.call(this, 'DELETE', `/api/instances/${getInstanceId(i)}`);
					} else if (operation === 'create') {
						const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
						responseData = await wasupApiRequest.call(this, 'POST', '/api/instances', cleanObject(fields));
					} else if (operation === 'onboard') {
						const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
						const body: IDataObject = cleanObject({
							phone: this.getNodeParameter('phone', i) as string,
							name: fields.name,
							webhookUrl: fields.webhookUrl,
							profileName: fields.profileName,
							profileStatus: fields.profileStatus,
						});
						if (fields.behaviorProfile) {
							body.behaviorSettings = { behaviorProfile: fields.behaviorProfile };
						}
						responseData = await wasupApiRequest.call(this, 'POST', '/api/onboard', body);
					} else if (operation === 'update') {
						const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
						const body: IDataObject = cleanObject({
							name: fields.name,
							webhookUrl: fields.webhookUrl,
						});
						if (fields.behaviorProfile) body.behaviorSettings = { behaviorProfile: fields.behaviorProfile };
						if (fields.antiBanPreset) body.antiBanSettings = { preset: fields.antiBanPreset };
						responseData = await wasupApiRequest.call(this, 'PUT', `/api/instances/${getInstanceId(i)}`, body);
					}
				}

				// ----------------------------------------------------------------
				// CONNECTION
				// ----------------------------------------------------------------
				else if (resource === 'connection') {
					const id = getInstanceId(i);
					if (operation === 'connect') {
						const pairingPhone = this.getNodeParameter('pairingPhone', i, '') as string;
						responseData = await wasupApiRequest.call(
							this,
							'POST',
							`/api/instances/${id}/connect`,
							cleanObject({ pairingPhone }),
						);
					} else if (operation === 'disconnect') {
						const revoke = this.getNodeParameter('revoke', i, false) as boolean;
						responseData = await wasupApiRequest.call(this, 'POST', `/api/instances/${id}/disconnect`, { revoke });
					} else if (operation === 'clearAuth') {
						responseData = await wasupApiRequest.call(this, 'POST', `/api/instances/${id}/clear-auth`);
					} else if (operation === 'pair') {
						const phoneNumber = this.getNodeParameter('phoneNumber', i) as string;
						responseData = await wasupApiRequest.call(this, 'POST', `/api/instances/${id}/pair`, { phoneNumber });
					} else if (operation === 'getStatus') {
						responseData = await wasupApiRequest.call(this, 'GET', `/api/instances/${id}/connection`);
					} else if (operation === 'getQr') {
						const format = this.getNodeParameter('qrFormat', i, 'json') as string;
						if (format === 'image') {
							const credentials = await this.getCredentials('wasupApi');
							const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');
							const buffer = (await this.helpers.httpRequestWithAuthentication.call(this, 'wasupApi', {
								method: 'GET',
								url: `${baseUrl}/api/instances/${id}/qr`,
								qs: { format: 'image' },
								encoding: 'arraybuffer',
								returnFullResponse: false,
							})) as Buffer;
							const binaryProperty = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
							binary[binaryProperty] = await this.helpers.prepareBinaryData(
								Buffer.from(buffer),
								`${id}-qr.png`,
								'image/png',
							);
							responseData = { success: true, instanceId: id, format: 'image' };
						} else {
							responseData = await wasupApiRequest.call(this, 'GET', `/api/instances/${id}/qr`);
						}
					}
				}

				// ----------------------------------------------------------------
				// MESSAGE
				// ----------------------------------------------------------------
				else if (resource === 'message') {
					responseData = await handleMessage.call(this, operation, i, getInstanceId);
				}

				// ----------------------------------------------------------------
				// PROFILE
				// ----------------------------------------------------------------
				else if (resource === 'profile') {
					const id = getInstanceId(i);
					if (operation === 'get') {
						responseData = await wasupApiRequest.call(this, 'GET', `/api/instances/${id}/profile`);
					} else if (operation === 'setName') {
						responseData = await wasupApiRequest.call(this, 'PUT', `/api/instances/${id}/profile/name`, {
							name: this.getNodeParameter('name', i) as string,
						});
					} else if (operation === 'setStatus') {
						responseData = await wasupApiRequest.call(this, 'PUT', `/api/instances/${id}/profile/status`, {
							status: this.getNodeParameter('status', i) as string,
						});
					} else if (operation === 'setPicture') {
						responseData = await wasupApiRequest.call(this, 'PUT', `/api/instances/${id}/profile/picture`, {
							imageUrl: this.getNodeParameter('imageUrl', i) as string,
						});
					} else if (operation === 'removePicture') {
						responseData = await wasupApiRequest.call(this, 'DELETE', `/api/instances/${id}/profile/picture`);
					}
				}

				// ----------------------------------------------------------------
				// BEHAVIOR
				// ----------------------------------------------------------------
				else if (resource === 'behavior') {
					const id = getInstanceId(i);
					if (operation === 'get') {
						responseData = await wasupApiRequest.call(this, 'GET', `/api/instances/${id}/behavior`);
					} else if (operation === 'update') {
						const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
						const body = cleanObject({
							behaviorProfile: this.getNodeParameter('behaviorProfile', i) as string,
							...fields,
						});
						responseData = await wasupApiRequest.call(this, 'PUT', `/api/instances/${id}/behavior`, body);
					}
				}

				// ----------------------------------------------------------------
				// ANTI-BAN (LEGACY)
				// ----------------------------------------------------------------
				else if (resource === 'antiBan') {
					const id = getInstanceId(i);
					if (operation === 'get') {
						responseData = await wasupApiRequest.call(this, 'GET', `/api/instances/${id}/anti-ban`);
					} else if (operation === 'update') {
						const preset = this.getNodeParameter('preset', i) as string;
						const custom = this.getNodeParameter('customLimits', i, {}) as IDataObject;
						const body = cleanObject({ preset, ...(preset === 'custom' ? custom : {}) });
						responseData = await wasupApiRequest.call(this, 'PUT', `/api/instances/${id}/anti-ban`, body);
					}
				}

				// ----------------------------------------------------------------
				// ANTI-BAN V2
				// ----------------------------------------------------------------
				else if (resource === 'antiBanV2') {
					const id = getInstanceId(i);
					const base = `/api/instances/${id}/antiban-v2`;
					if (operation === 'getStatus') {
						responseData = await wasupApiRequest.call(this, 'GET', base);
					} else if (operation === 'getConfig') {
						responseData = await wasupApiRequest.call(this, 'GET', `${base}/config`);
					} else if (operation === 'getHealth') {
						responseData = await wasupApiRequest.call(this, 'GET', `${base}/health`);
					} else if (operation === 'getWarmup') {
						responseData = await wasupApiRequest.call(this, 'GET', `${base}/warmup`);
					} else if (operation === 'pause') {
						responseData = await wasupApiRequest.call(this, 'POST', `${base}/pause`);
					} else if (operation === 'resume') {
						responseData = await wasupApiRequest.call(this, 'POST', `${base}/resume`);
					} else if (operation === 'reset') {
						responseData = await wasupApiRequest.call(this, 'POST', `${base}/reset`);
					} else if (operation === 'updateConfig') {
						const overrides = this.getNodeParameter('overrides', i, {}) as IDataObject;
						const modules = parseJsonParam(this.getNodeParameter('modules', i, '{}'), 'Modules');
						const body = cleanObject({
							enabled: this.getNodeParameter('enabled', i) as boolean,
							preset: this.getNodeParameter('preset', i) as string,
							overrides: Object.keys(overrides).length ? overrides : undefined,
							alertsWebhook: this.getNodeParameter('alertsWebhook', i, '') as string,
							modules: Object.keys(modules as IDataObject).length ? modules : undefined,
						});
						responseData = await wasupApiRequest.call(this, 'PUT', `${base}/config`, body);
					}
				}

				// ----------------------------------------------------------------
				// HANDOFF
				// ----------------------------------------------------------------
				else if (resource === 'handoff') {
					const id = getInstanceId(i);
					const base = `/api/instances/${id}/handoff`;
					if (operation === 'list') {
						responseData = await wasupApiRequest.call(this, 'GET', base);
					} else if (operation === 'clearAll') {
						responseData = await wasupApiRequest.call(this, 'DELETE', base);
					} else if (operation === 'getSettings') {
						responseData = await wasupApiRequest.call(this, 'GET', `${base}/settings`);
					} else if (operation === 'set') {
						responseData = await wasupApiRequest.call(this, 'POST', base, {
							phone: this.getNodeParameter('phone', i) as string,
							active: this.getNodeParameter('active', i) as boolean,
						});
					} else if (operation === 'updateSettings') {
						const keywords = (this.getNodeParameter('resumeKeywords', i, '') as string)
							.split(',')
							.map((k) => k.trim())
							.filter(Boolean);
						const body = cleanObject({
							resumeKeywords: keywords.length ? keywords : undefined,
							resumeMessage: this.getNodeParameter('resumeMessage', i, '') as string,
							blockApiSendsDuringHandoff: this.getNodeParameter(
								'blockApiSendsDuringHandoff',
								i,
								true,
							) as boolean,
						});
						responseData = await wasupApiRequest.call(this, 'PUT', `${base}/settings`, body);
					}
				}

				// ----------------------------------------------------------------
				// WEBHOOK
				// ----------------------------------------------------------------
				else if (resource === 'webhook') {
					if (operation === 'getGlobal') {
						responseData = await wasupApiRequest.call(this, 'GET', '/api/webhook');
					} else {
						const id = getInstanceId(i);
						const base = `/api/instances/${id}/webhook`;
						if (operation === 'get') {
							responseData = await wasupApiRequest.call(this, 'GET', base);
						} else if (operation === 'test') {
							responseData = await wasupApiRequest.call(this, 'POST', `${base}/test`);
						} else if (operation === 'set') {
							responseData = await wasupApiRequest.call(this, 'PUT', base, {
								webhookUrl: this.getNodeParameter('webhookUrl', i, '') as string,
							});
						}
					}
				}

				// ----------------------------------------------------------------
				// MEDIA
				// ----------------------------------------------------------------
				else if (resource === 'media') {
					const id = getInstanceId(i);
					if (operation === 'list') {
						responseData = await wasupApiRequest.call(this, 'GET', `/api/instances/${id}/media`);
					} else if (operation === 'get') {
						const mediaId = this.getNodeParameter('mediaId', i) as string;
						responseData = await wasupApiRequest.call(this, 'GET', `/api/instances/${id}/media/${mediaId}`);
					}
				}

				// ----------------------------------------------------------------
				// SYSTEM
				// ----------------------------------------------------------------
				else if (resource === 'system') {
					if (operation === 'health') {
						responseData = await wasupApiRequest.call(this, 'GET', '/api/health');
					} else if (operation === 'status') {
						responseData = await wasupApiRequest.call(this, 'GET', '/api/status');
					} else if (operation === 'storageStatus') {
						responseData = await wasupApiRequest.call(this, 'GET', '/api/storage/status');
					} else if (operation === 'generateApiKey') {
						responseData = await wasupApiRequest.call(this, 'POST', '/api/generate-api-key');
					} else if (operation === 'reloadBehavior') {
						responseData = await wasupApiRequest.call(this, 'POST', '/api/system/reload-behavior-from-disk');
					}
				}

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray((responseData ?? {}) as IDataObject | IDataObject[]),
					{ itemData: { item: i } },
				);
				if (Object.keys(binary).length) {
					for (const entry of executionData) entry.binary = binary;
				}
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

/**
 * Builds and sends all Message-resource operations.
 */
async function handleMessage(
	this: IExecuteFunctions,
	operation: string,
	i: number,
	getInstanceId: (i: number) => string,
): Promise<IDataObject | IDataObject[]> {
	// getHistory has no auto-select and no recipient
	if (operation === 'getHistory') {
		const id = getInstanceId(i);
		const filters = this.getNodeParameter('historyFilters', i, {}) as IDataObject;
		return wasupApiRequest.call(this, 'GET', `/api/instances/${id}/messages`, {}, cleanObject(filters));
	}

	// getStatus polls an outbound message's delivery status by id (instance-scoped)
	if (operation === 'getStatus') {
		const id = getInstanceId(i);
		const messageId = this.getNodeParameter('messageId', i) as string;
		return wasupApiRequest.call(
			this,
			'GET',
			`/api/instances/${id}/messages/${encodeURIComponent(messageId)}/status`,
		);
	}

	const autoSelect =
		operation === 'sendRaw' ? false : (this.getNodeParameter('autoSelect', i, false) as boolean);
	const sendEndpoint = autoSelect ? '/api/send' : `/api/instances/${getInstanceId(i)}/send`;
	const reactEndpoint = autoSelect ? '/api/react' : `/api/instances/${getInstanceId(i)}/react`;

	// React
	if (operation === 'react') {
		const to = this.getNodeParameter('to', i) as string;
		const body = cleanObject({
			to,
			to_phone: autoSelect ? to : undefined,
			messageId: this.getNodeParameter('messageId', i) as string,
			emoji: this.getNodeParameter('emoji', i, '') as string,
			fromMe: this.getNodeParameter('fromMe', i, false) as boolean,
			from_phone: autoSelect ? (this.getNodeParameter('fromPhone', i, '') as string) : undefined,
		});
		return wasupApiRequest.call(this, 'POST', reactEndpoint, body);
	}

	// Raw passthrough
	if (operation === 'sendRaw') {
		const raw = parseJsonParam(this.getNodeParameter('rawBody', i), 'Body') as IDataObject;
		return wasupApiRequest.call(this, 'POST', sendEndpoint, raw);
	}

	// Structured sends
	const to = this.getNodeParameter('to', i) as string;
	const body: IDataObject = { to };
	if (autoSelect) {
		const fromPhone = this.getNodeParameter('fromPhone', i, '') as string;
		if (fromPhone) body.from_phone = fromPhone;
	}

	if (operation === 'sendText') {
		body.message = this.getNodeParameter('message', i) as string;
		body.linkPreview = this.getNodeParameter('linkPreview', i, true) as boolean;
	} else if (operation === 'sendMedia') {
		const mediaOptions = this.getNodeParameter('mediaOptions', i, {}) as IDataObject;
		body.messageType = this.getNodeParameter('mediaType', i) as string;
		body.mediaUrl = this.getNodeParameter('mediaUrl', i) as string;
		const caption = this.getNodeParameter('message', i, '') as string;
		if (caption) body.message = caption;
		Object.assign(body, cleanObject(mediaOptions));
	} else if (operation === 'sendButtons' || operation === 'sendCta') {
		// Quick-reply buttons and a CTA URL button can be combined in one message
		// (the worker supports up to 3 interactive actions: quick replies + 1 CTA).
		body.text = this.getNodeParameter('text', i) as string;

		const buttonsCollection = this.getNodeParameter('buttons', i, {}) as IDataObject;
		const buttons = (buttonsCollection.button as IDataObject[]) ?? [];
		if (buttons.length) {
			body.buttons = buttons.map((b) => ({ id: b.id, text: b.text }));
		}

		const ctaUrlValue = (this.getNodeParameter('ctaUrl', i, '') as string).trim();
		if (ctaUrlValue) {
			body.ctaUrl = {
				url: ctaUrlValue,
				label: this.getNodeParameter('ctaLabel', i, 'Open') as string,
			};
		}

		if (operation === 'sendCta' && !ctaUrlValue) {
			throw new Error('CTA URL is required for "Send CTA URL Button".');
		}
		if (!buttons.length && !ctaUrlValue) {
			throw new Error('Add at least one quick-reply button or a CTA URL.');
		}

		const footer = this.getNodeParameter('footer', i, '') as string;
		if (footer) body.footer = footer;
	} else if (operation === 'sendList') {
		const listOptions = this.getNodeParameter('listOptions', i, {}) as IDataObject;
		body.messageType = 'list';
		body.text = this.getNodeParameter('text', i) as string;
		body.sections = parseJsonParam(this.getNodeParameter('sections', i), 'Sections');
		Object.assign(body, cleanObject(listOptions));
		const footer = this.getNodeParameter('footer', i, '') as string;
		if (footer) body.footer = footer;
	} else if (operation === 'sendLocation') {
		const locationOptions = this.getNodeParameter('locationOptions', i, {}) as IDataObject;
		body.messageType = 'location';
		body.latitude = this.getNodeParameter('latitude', i) as number;
		body.longitude = this.getNodeParameter('longitude', i) as number;
		Object.assign(body, cleanObject(locationOptions));
	} else if (operation === 'sendContact') {
		body.messageType = 'contact';
		body.contactCard = {
			displayName: this.getNodeParameter('displayName', i) as string,
			phoneNumber: this.getNodeParameter('contactPhone', i) as string,
		};
	}

	// Advanced overrides (typing, delay, contact save) for all structured sends
	const advanced = this.getNodeParameter('advancedOptions', i, {}) as IDataObject;
	Object.assign(body, cleanObject(advanced));

	return wasupApiRequest.call(this, 'POST', sendEndpoint, body);
}
