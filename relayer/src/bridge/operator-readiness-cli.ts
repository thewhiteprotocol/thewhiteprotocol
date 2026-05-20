import { buildHostedOperatorReadiness } from './operator-readiness';

const readiness = buildHostedOperatorReadiness();
console.log(JSON.stringify(readiness, null, 2));
process.exit(readiness.ok ? 0 : 1);
