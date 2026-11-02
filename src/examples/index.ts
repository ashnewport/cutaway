import domain from './domain.mmd?raw';
import deploy from './deploy.dot?raw';
import oidc from './oidc.mmd?raw';
import orderState from './order-state.mmd?raw';
import presignedUpload from './presigned-upload.puml?raw';
import threeTier from './three-tier.mmd?raw';

export interface Example {
	id: string;
	name: string;
	source: string;
}

export const EXAMPLES: Example[] = [
	{ id: 'three-tier', name: 'Web app, top to bottom', source: threeTier },
	{ id: 'oidc', name: 'OIDC and OAuth2 sign-in', source: oidc },
	{ id: 'upload', name: 'Presigned upload (PlantUML)', source: presignedUpload },
	{ id: 'deploy', name: 'Deploy pipeline (DOT)', source: deploy },
	{ id: 'state', name: 'Order lifecycle (state)', source: orderState },
	{ id: 'domain', name: 'Domain model (class)', source: domain }
];
