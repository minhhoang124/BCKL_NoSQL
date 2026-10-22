/** Mirror the canonical Pydantic model, including its cross-field invariants. */
export const healthStatuses = [
  'READY',
  'DEGRADED',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;
export type HealthStatus = (typeof healthStatuses)[number];
const reasons = [
  'NOT_CHECKED',
  'SNAPSHOT_STALE',
  'PROBE_BUSY',
  'PROBE_TIMEOUT',
  'CLOCK_SKEW',
  'MODEL_NOT_LOADED',
  'ENCODE_FAILED',
  'INVALID_EMBEDDING',
  'DIMENSION_MISMATCH',
  'INDEX_NOT_LOADED',
  'INDEX_SEARCH_FAILED',
  'INVALID_INDEX_RESULT',
  'ES_UNREACHABLE',
  'ES_TIMEOUT',
  'ES_AUTH_FAILED',
  'ES_INDEX_MISSING',
  'ES_MAPPING_INVALID',
  'ES_QUERY_FAILED',
  'RRF_CONFIG_INVALID',
];
const uncertain = reasons.slice(0, 5);
export const componentNames = [
  'clipImage',
  'clipText',
  'faiss',
  'elasticsearch',
] as const;
export const capabilityNames = [
  'semanticText',
  'imageSearch',
  'hybridText',
] as const;
export interface HealthComponent {
  loaded: boolean | null;
  status: HealthStatus;
  checkedAt: string | null;
  expiresAt: string | null;
  lastSuccessAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  warningCodes: string[];
  dimension?: number | null;
  vectorCount?: number | null;
  indexExists?: boolean | null;
  readable?: boolean | null;
}
export interface Capability {
  status: HealthStatus;
  reasonCodes: string[];
}
export interface SearchHealthSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  components: Record<(typeof componentNames)[number], HealthComponent>;
  capabilities: Record<(typeof capabilityNames)[number], Capability>;
}
function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid Search health response');
}
function exact(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  requireValid(
    value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  requireValid(
    Object.keys(value).sort().join(',') === [...keys].sort().join(','),
  );
}
function timestamp(value: unknown): number {
  requireValid(
    typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
  );
  const result = Date.parse(value);
  requireValid(
    Number.isFinite(result) && new Date(result).toISOString() === value,
  );
  return result;
}
const usable = (status: HealthStatus) =>
  status === 'READY' || status === 'DEGRADED';
function codes(
  value: unknown,
  allowed: readonly string[],
): asserts value is string[] {
  requireValid(
    Array.isArray(value) &&
      value.length <= allowed.length &&
      value.every(
        (item) => typeof item === 'string' && allowed.includes(item),
      ) &&
      new Set(value).size === value.length,
  );
}
export function dependencyStatus(values: HealthStatus[]): HealthStatus {
  if (values.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (values.includes('UNKNOWN')) return 'UNKNOWN';
  return values.includes('DEGRADED') ? 'DEGRADED' : 'READY';
}
export function aggregateCapabilities(values: HealthStatus[]): HealthStatus {
  if (values.every((value) => value === 'READY')) return 'READY';
  if (values.some(usable)) return 'DEGRADED';
  return values.includes('UNKNOWN') ? 'UNKNOWN' : 'UNAVAILABLE';
}
const dependencies = {
  semanticText: ['clipText', 'faiss'],
  imageSearch: ['clipImage', 'faiss'],
  hybridText: ['clipText', 'faiss', 'elasticsearch'],
} as const;

export function parseSearchHealth(
  raw: unknown,
  now = Date.now(),
): SearchHealthSnapshot {
  exact(raw, ['schemaVersion', 'generatedAt', 'components', 'capabilities']);
  requireValid(raw.schemaVersion === 1);
  const generated = timestamp(raw.generatedAt);
  requireValid(generated <= now + 5000);
  exact(raw.components, componentNames);
  exact(raw.capabilities, capabilityNames);
  const common = [
    'loaded',
    'status',
    'checkedAt',
    'expiresAt',
    'lastSuccessAt',
    'durationMs',
    'errorCode',
    'warningCodes',
  ];
  for (const name of componentNames) {
    const part = raw.components[name];
    const metadata =
      name === 'elasticsearch'
        ? ['indexExists', 'readable']
        : name === 'faiss'
          ? ['dimension', 'vectorCount']
          : ['dimension'];
    exact(part, [...common, ...metadata]);
    requireValid(healthStatuses.includes(part.status as HealthStatus));
    requireValid(part.loaded === null || typeof part.loaded === 'boolean');
    requireValid(
      part.errorCode === null ||
        (typeof part.errorCode === 'string' &&
          reasons.includes(part.errorCode)),
    );
    codes(part.warningCodes, ['EMPTY_INDEX', 'ES_REPLICA_WARNING']);
    const checked = part.checkedAt === null ? null : timestamp(part.checkedAt);
    const expires = part.expiresAt === null ? null : timestamp(part.expiresAt);
    const success =
      part.lastSuccessAt === null ? null : timestamp(part.lastSuccessAt);
    requireValid((checked === null) === (expires === null));
    if (checked !== null && expires !== null) {
      requireValid(
        expires > checked && expires - checked <= 60000 && checked <= generated,
      );
    }
    requireValid(success === null || (checked !== null && success <= checked));
    requireValid(
      part.durationMs === null ||
        (typeof part.durationMs === 'number' &&
          Number.isFinite(part.durationMs) &&
          part.durationMs >= 0),
    );
    if (checked === null) requireValid(part.durationMs === null);
    if (usable(part.status as HealthStatus)) {
      requireValid(
        checked !== null &&
          part.durationMs !== null &&
          part.lastSuccessAt === part.checkedAt &&
          part.errorCode === null,
      );
      if (part.status === 'DEGRADED')
        requireValid(part.warningCodes.length > 0);
    } else requireValid(part.errorCode !== null);
    if (uncertain.includes(part.errorCode as string))
      requireValid(part.status === 'UNKNOWN');
    if (expires !== null && generated >= expires)
      requireValid(
        part.status === 'UNKNOWN' && part.errorCode === 'SNAPSHOT_STALE',
      );
    if (name === 'elasticsearch') {
      requireValid(part.loaded === null);
      requireValid(
        [part.indexExists, part.readable].every(
          (value) => value === null || typeof value === 'boolean',
        ),
      );
      if (usable(part.status as HealthStatus))
        requireValid(part.indexExists === true && part.readable === true);
    } else {
      requireValid(
        part.dimension === null ||
          (typeof part.dimension === 'number' &&
            Number.isSafeInteger(part.dimension) &&
            part.dimension > 0),
      );
      if (usable(part.status as HealthStatus))
        requireValid(part.loaded === true && part.dimension !== null);
      if (name === 'faiss') {
        requireValid(
          part.vectorCount === null ||
            (typeof part.vectorCount === 'number' &&
              Number.isSafeInteger(part.vectorCount) &&
              part.vectorCount >= 0),
        );
        requireValid(!part.warningCodes.includes('ES_REPLICA_WARNING'));
        if (usable(part.status as HealthStatus))
          requireValid(
            part.vectorCount !== null &&
              (part.vectorCount === 0) ===
                part.warningCodes.includes('EMPTY_INDEX'),
          );
      } else requireValid(part.warningCodes.length === 0);
    }
  }
  // All structural checks above precede the cast; no unvalidated data is projected.
  const snapshot = raw as unknown as SearchHealthSnapshot;
  for (const name of capabilityNames) {
    const cap = snapshot.capabilities[name];
    exact(cap, ['status', 'reasonCodes']);
    requireValid(healthStatuses.includes(cap.status));
    codes(cap.reasonCodes, reasons);
    requireValid(
      usable(cap.status)
        ? cap.reasonCodes.length === 0
        : cap.reasonCodes.length > 0,
    );
    const parts = dependencies[name].map((key) => snapshot.components[key]);
    const model = parts[0],
      index = snapshot.components.faiss;
    const mismatch =
      usable(model.status) &&
      usable(index.status) &&
      model.dimension !== index.dimension;
    const rrf =
      name === 'hybridText' && cap.reasonCodes.includes('RRF_CONFIG_INVALID');
    requireValid(
      cap.status ===
        (mismatch || rrf
          ? 'UNAVAILABLE'
          : dependencyStatus(parts.map((part) => part.status))),
    );
    if (mismatch) requireValid(cap.reasonCodes.includes('DIMENSION_MISMATCH'));
    for (const reason of cap.reasonCodes) {
      if (reason === 'RRF_CONFIG_INVALID') requireValid(name === 'hybridText');
      requireValid(
        parts.some((part) => part.errorCode === reason) ||
          (reason === 'DIMENSION_MISMATCH' && mismatch) ||
          (reason === 'RRF_CONFIG_INVALID' && rrf),
      );
    }
  }
  return structuredClone(snapshot);
}

/** Consumer freshness is a separate projection: never rewrite producer observations. */
export function effectiveCapabilities(
  snapshot: SearchHealthSnapshot,
  now: number,
) {
  const result = {} as SearchHealthSnapshot['capabilities'];
  for (const name of capabilityNames) {
    const parts = dependencies[name].map((key) => snapshot.components[key]);
    const states = parts.map((part) =>
      part.expiresAt !== null && Date.parse(part.expiresAt) <= now
        ? 'UNKNOWN'
        : part.status,
    );
    const currentReasons = parts.flatMap((part) =>
      part.expiresAt !== null && Date.parse(part.expiresAt) <= now
        ? ['SNAPSHOT_STALE']
        : part.errorCode
          ? [part.errorCode]
          : [],
    );
    const mismatch =
      usable(states[0]) &&
      usable(states[1]) &&
      parts[0].dimension !== parts[1].dimension;
    const rrf =
      name === 'hybridText' &&
      Date.parse(snapshot.generatedAt) + 60000 > now &&
      snapshot.capabilities[name].reasonCodes.includes('RRF_CONFIG_INVALID');
    const status = mismatch || rrf ? 'UNAVAILABLE' : dependencyStatus(states);
    const reasonCodes = usable(status)
      ? []
      : [
          ...new Set([
            ...currentReasons,
            ...(mismatch ? ['DIMENSION_MISMATCH'] : []),
            ...(rrf ? ['RRF_CONFIG_INVALID'] : []),
          ]),
        ];
    result[name] = { status, reasonCodes };
  }
  return result;
}
