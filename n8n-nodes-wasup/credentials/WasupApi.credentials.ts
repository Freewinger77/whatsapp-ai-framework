import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class WasupApi implements ICredentialType {
	name = 'wasupApi';

	displayName = 'Wasup API';

	documentationUrl = 'https://dev.wasup.co';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://wasup2.northeurope.cloudapp.azure.com',
			required: true,
			placeholder: 'https://your-deployment.cloudapp.azure.com',
			description:
				'The base URL of your Wasup deployment, with no trailing slash. Each deployment (worker) has its own URL — point this at the one you want to control.',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Deployment admin key (X-API-Key) or a per-instance "wsp_v3_*" key. Leave blank only for open deployments that have no API_KEY configured.',
		},
	];

	// Injects the key on every request as X-API-Key (the header Wasup expects).
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	// Validates connectivity + the key against a lightweight authenticated endpoint.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/instances',
			method: 'GET',
		},
	};
}
