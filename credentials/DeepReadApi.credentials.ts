import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class DeepReadApi implements ICredentialType {
	name = 'deepReadApi';

	displayName = 'DeepRead API';

	icon: Icon = 'file:../nodes/DeepRead/deepread.svg';

	documentationUrl = 'https://www.deepread.tech/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'sk_live_...',
			description: 'Get your API key from deepread.tech/dashboard',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.deepread.tech',
			url: '/v1/pipelines',
			method: 'GET',
		},
	};
}
