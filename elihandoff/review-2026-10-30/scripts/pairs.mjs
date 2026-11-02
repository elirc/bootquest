import fs from 'node:fs';
const root = 'C:/Users/Owner/Desktop/selfboot/tools/seed/authoring';
function get(spec) { const [bank, mod, slug] = spec.split('/'); const j = JSON.parse(fs.readFileSync(`${root}/${bank}/${mod}.json`, 'utf8')); return j.exercises.find(e => e.slug === slug); }
const csTest = /Test\("((?:[^"\\]|\\.)*)"/g;
const javaTest = /test\("((?:[^"\\]|\\.)*)"/g;
function brief(spec) {
  const ex = get(spec); if (!ex) return `!! ${spec}`;
  const yt = (ex.instructions.split(/\*\*Your task\.?\*\*/)[1] || '').split(/\*\*Worked/)[0].trim();
  let names = [];
  if (Array.isArray(ex.tests)) names = ex.tests.map(t => t.name);
  else if (typeof ex.tests === 'string') names = [...ex.tests.matchAll(csTest)].map(m => m[1]);
  else names = [...ex.starter.matchAll(javaTest)].map(m => m[1]);
  return `--- ${spec} [d${ex.difficulty}] ${ex.title}\n  TASK: ${yt.replace(/\n/g, ' ').slice(0, 420)}\n  TESTS: ${names.join(' | ').slice(0, 520)}`;
}
const groups = {
  'token bucket': ['csdrills/08-service-data-structures/05-token-bucket', 'sysdrills/02-caching-and-pools/05-token-bucket'],
  'sliding/fixed window': ['csdrills/08-service-data-structures/04-sliding-window', 'sysdrills/02-caching-and-pools/04-rate-limit-window'],
  'weighted allocation': ['csdrills/04-money-and-rounding/05-weighted-allocation', 'javadrills/08-money-math/01-weighted-allocation'],
  'rounding modes': ['csdrills/04-money-and-rounding/02-midpoint-rounding', 'javadrills/11-cross-language-bugs/01-rounding-mode', 'javadrills/08-money-math/02-line-vs-invoice-rounding'],
  'vat/basis points': ['csdrills/04-money-and-rounding/03-vat-in-cents', 'javadrills/08-money-math/03-basis-points'],
  'dst': ['csdrills/05-time-and-scheduling/09-dst-wall-clock', 'javadrills/09-instants-and-zones/05-dst-day'],
  'utc buckets': ['csdrills/05-time-and-scheduling/03-utc-buckets', 'javadrills/09-instants-and-zones/06-truncation-buckets'],
  'epoch': ['csdrills/05-time-and-scheduling/01-epoch-roundtrip', 'javadrills/09-instants-and-zones/01-epoch-instants'],
  'utf8 budget': ['csdrills/06-text-at-the-edge/09-utf8-byte-budget', 'javadrills/11-cross-language-bugs/08-utf8-byte-budget', 'javadrills/06-strings-and-text/04-codepoints', 'sysdrills/08-encoding-and-counting/01-utf8-bytes'],
  'littles law': ['sysdrills/01-estimation/07-littles-law', 'sysdrills/06-concurrency-and-throughput/04-littles-law-worker-pool', 'sysdrills/10-capacity-and-cost/01-cores-for-load', 'sysdrills/02-caching-and-pools/03-connection-pool'],
  'drain': ['sysdrills/06-concurrency-and-throughput/01-queue-drain-time', 'sysdrills/09-queues-and-backlog/03-consumers-to-drain', 'sysdrills/11-replication-and-consistency/07-lag-breach-eta'],
  'error budget': ['sysdrills/03-reliability-math/03-error-budget', 'sysdrills/14-observability-and-telemetry/04-error-budget-burn-rate', 'sysdrills/12-multi-region-and-failover/04-failover-error-burn'],
  'cache fit': ['sysdrills/01-estimation/05-cache-working-set', 'sysdrills/02-caching-and-pools/02-lru-capacity', 'sysdrills/13-search-and-indexing/08-vector-index-memory', 'sysdrills/05-sql-and-indexing/08-index-memory-fit'],
  'retries': ['sysdrills/03-reliability-math/06-retry-budget', 'sysdrills/04-networking-and-latency/05-retries-within-deadline', 'sysdrills/06-concurrency-and-throughput/07-retry-storm', 'sysdrills/09-queues-and-backlog/04-retry-amplification'],
  'build once': ['csdrills/02-async-composition/02-memoize-the-task', 'csdrills/09-thread-safety/04-getoradd-lazy'],
  'immutability java': ['javadrills/01-collections-behavior/01-three-list-factories', 'javadrills/01-collections-behavior/03-view-vs-copy', 'javadrills/04-collectors/05-collectingandthen', 'javadrills/01-collections-behavior/08-set-of-rules'],
  'storage size': ['sysdrills/01-estimation/03-storage-growth', 'sysdrills/08-encoding-and-counting/03-row-size', 'sysdrills/10-capacity-and-cost/02-storage-egress-bill', 'sysdrills/10-capacity-and-cost/06-replication-and-backups'],
  'bandwidth': ['sysdrills/01-estimation/04-bandwidth-budget', 'sysdrills/04-networking-and-latency/07-payload-transfer-time'],
  'paging': ['csdrills/10-crud-endpoint-logic/01-page-envelope', 'csdrills/10-crud-endpoint-logic/02-clamp-params', 'sysdrills/05-sql-and-indexing/05-offset-pagination-cost'],
  'quorum': ['sysdrills/03-reliability-math/01-quorum-check', 'sysdrills/03-reliability-math/08-replication-staleness', 'sysdrills/11-replication-and-consistency/01-quorum-step-latency'],
  'hash stability': ['csdrills/07-hashing-and-identifiers/07-stable-bucket', 'csdrills/07-hashing-and-identifiers/03-sha256-hex'],
};
for (const [g, specs] of Object.entries(groups)) { console.log(`\n===== ${g}`); for (const s of specs) console.log(brief(s)); }
