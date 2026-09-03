import type { INodeProperties } from 'n8n-workflow';

/**
 * Reusable "Instance" picker. Renders a dropdown populated from the deployment
 * (via the getInstances loadOptions method) but still allows an expression /
 * manual id, so it works for instances that were just created in a prior node.
 */
export function instanceIdField(
	resource: string,
	operations?: string[],
): INodeProperties {
	return {
		displayName: 'Instance',
		name: 'instanceId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The WhatsApp instance (number) to act on',
		displayOptions: {
			show: {
				resource: [resource],
				...(operations ? { operation: operations } : {}),
			},
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchInstances',
					searchable: true,
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'wa_lxyz123_abc45',
			},
		],
	};
}
