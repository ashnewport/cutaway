import type { NodeKind, PayloadKind } from './types.ts';

/** First match wins, so more specific nouns come before generic ones like "user" or "page". */
const KIND_RULES: [RegExp, NodeKind][] = [
	[/\b(gateway|igw|nat|vpn|apigw|proxy|envoy|nginx|vpc endpoint)\b/, 'gateway'],
	[/\b(internet|public web|www|wan|world)\b/, 'internet'],
	[/\b(dns|route ?53)\b/, 'dns'],
	[/\b(cdn|cloudfront|fastly|akamai|edge cache)\b/, 'cdn'],
	[/\b(waf|firewall|security group|nacl)\b/, 'firewall'],
	[/\b(alb|nlb|elb|load ?balancer|lb|ingress|haproxy)\b/, 'loadbalancer'],
	[/\b(kms|secrets?|vault|jwks|hsm|signing key)\b/, 'secret'],
	[
		/\b(auth|authn|authz|oauth2?|oidc|idp|identity provider|cognito|okta|auth0|keycloak|sso|authorization server)\b/,
		'auth'
	],
	[/\b(queue|sqs|kafka|rabbitmq|sns|pubsub|event bus|topic|outbox|stream)\b/, 'queue'],
	[/\b(cache|redis|memcached|elasticache|valkey|session store)\b/, 'cache'],
	[/\b(s3|bucket|blob|object store|storage|gcs|file store|efs)\b/, 'storage'],
	[
		/\b(db|database|postgres|postgresql|mysql|rds|aurora|dynamo|dynamodb|mongo|mongodb|sql|replica|directory)\b/,
		'database'
	],
	[/\b(lambda|function|cron|worker|job)\b/, 'function'],
	[
		/\b(page|screen|form|view|ui|browser|button|modal|dialog|dashboard|spa|tab|consent|app shell)\b/,
		'screen'
	],
	[
		/\b(user|users|customer|shopper|person|human|resource owner|actor|developer|engineer|operator|admin)\b/,
		'actor'
	]
];

export function inferKind(id: string, label: string, fallback: NodeKind = 'service'): NodeKind {
	const haystack = `${label} ${id.replace(/[_-]+/g, ' ')}`.toLowerCase();
	for (const [pattern, kind] of KIND_RULES) {
		if (pattern.test(haystack)) return kind;
	}
	return fallback;
}

const CREDENTIAL =
	/\b(tokens?|jwt|code|cookie|session|secret|key|pkce|verifier|challenge|nonce|credentials?|password|assertion|signature|presigned)\b/i;
const FAILURE =
	/\b(4\d\d|5\d\d|denied|reject(ed)?|declined|fail(ed|ure)?|error|invalid|timeout|forbidden)\b/i;

export function inferPayload(label: string, crossed: boolean): PayloadKind {
	if (crossed || FAILURE.test(label)) return 'error';
	if (CREDENTIAL.test(label)) return 'credential';
	return 'data';
}

const TIER_BY_KIND: Record<NodeKind, 'ui' | 'app' | 'infra'> = {
	actor: 'ui',
	screen: 'ui',
	service: 'app',
	function: 'app',
	auth: 'app',
	decision: 'app',
	state: 'app',
	class: 'app',
	terminal: 'app',
	database: 'infra',
	storage: 'infra',
	cache: 'infra',
	queue: 'infra',
	gateway: 'infra',
	loadbalancer: 'infra',
	internet: 'infra',
	cdn: 'infra',
	dns: 'infra',
	firewall: 'infra',
	secret: 'infra'
};

export const TIERS = [
	{ id: 'ui', title: 'User interface' },
	{ id: 'app', title: 'Application' },
	{ id: 'infra', title: 'Infrastructure' }
] as const;

export function tierForKind(kind: NodeKind): 'ui' | 'app' | 'infra' {
	return TIER_BY_KIND[kind];
}
