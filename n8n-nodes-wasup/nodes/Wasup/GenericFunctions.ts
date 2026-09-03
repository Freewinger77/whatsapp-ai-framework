import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

function asRecord(value: unknown): IDataObject | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: null;
}

function payloadHasDoNotRetry(value: unknown): IDataObject | null {
	if (Array.isArray(value)) {
		for (const row of value) {
			const hit = payloadHasDoNotRetry(row);
			if (hit) return hit;
		}
		return null;
	}
	const record = asRecord(value);
	if (!record) return null;
	if (record.doNotRetry === true) return record;
	const result = asRecord(record.result);
	if (result?.doNotRetry === true) return record;
	return null;
}

/**
 * Policy holds and 463 NACKs return HTTP 200 with doNotRetry so n8n
 * must not throw and must not retry the same cold send.
 */
export function extractDoNotRetryPayload(error: unknown): IDataObject | null {
	const err = asRecord(error) || {};
	const candidates: unknown[] = [
		err,
		err.error,
		err.description,
		err.context,
		asRecord(err.context)?.body,
		asRecord(err.context)?.data,
		asRecord(err.cause)?.response,
		asRecord(asRecord(err.cause)?.response)?.data,
		asRecord(err.response)?.data,
		err.messages,
	];
	for (const candidate of candidates) {
		if (typeof candidate === 'string') {
			try {
				const parsed = JSON.parse(candidate);
				const hit = payloadHasDoNotRetry(parsed);
				if (hit) return hit;
			} catch {
				/* not JSON */
			}
			continue;
		}
		if (Array.isArray(candidate)) {
			for (const row of candidate) {
				const hit = payloadHasDoNotRetry(row);
				if (hit) return hit;
			}
			continue;
		}
		const hit = payloadHasDoNotRetry(candidate);
		if (hit) return hit;
	}
	return null;
}

/**
 * Perform an authenticated request against a Wasup deployment.
 * The Base URL and API key both come from the `wasupApi` credentials,
 * so the same node works against any worker (wasup2, production, etc.).
 */
export async function wasupApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<any> {
	const credentials = await this.getCredentials('wasupApi');
	const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		qs,
		body,
		json: true,
		headers: {
			Accept: 'application/json',
		},
	};

	if (!Object.keys(body).length) {
		delete options.body;
	}
	if (!Object.keys(qs).length) {
		delete options.qs;
	}

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'wasupApi', options);
	} catch (error) {
		const payload = extractDoNotRetryPayload(error);
		if (payload) return payload;
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/**
 * loadOptions helper: populate a dropdown with the instances on the
 * configured deployment so users can pick one instead of typing the id.
 */
export async function getInstances(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const response = await wasupApiRequest.call(this, 'GET', '/api/instances');
	const instances = (response?.instances ?? []) as IDataObject[];

	return instances.map((instance) => {
		const status = instance.status ? ` (${instance.status})` : '';
		const phone = instance.connectedPhone ? ` · ${instance.connectedPhone}` : '';
		return {
			name: `${(instance.name as string) || (instance.id as string)}${phone}${status}`,
			value: instance.id as string,
		};
	});
}

/**
 * listSearch helper for the "Instance" resourceLocator dropdown.
 */
export async function searchInstances(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const response = await wasupApiRequest.call(this, 'GET', '/api/instances');
	const instances = (response?.instances ?? []) as IDataObject[];

	const results = instances
		.map((instance) => {
			const status = instance.status ? ` (${instance.status})` : '';
			const phone = instance.connectedPhone ? ` · ${instance.connectedPhone}` : '';
			return {
				name: `${(instance.name as string) || (instance.id as string)}${phone}${status}`,
				value: instance.id as string,
			};
		})
		.filter((entry) => {
			if (!filter) return true;
			const needle = filter.toLowerCase();
			return (
				entry.name.toLowerCase().includes(needle) ||
				entry.value.toLowerCase().includes(needle)
			);
		});

	return { results };
}

/**
 * Drop undefined/null/empty-string keys so we never send noise to the API.
 */
export function cleanObject(input: IDataObject): IDataObject {
	const output: IDataObject = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined || value === null || value === '') {
			continue;
		}
		output[key] = value;
	}
	return output;
}
