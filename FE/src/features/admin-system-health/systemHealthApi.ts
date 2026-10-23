import {
  ApiError,
  AuthSessionChangedError,
  fetchApi,
  getAuthSessionVersion,
} from '../../services/apiClient';
import type { ApiRequestOptions } from '../../services/apiClient';
import {
  aggregateCapabilities,
  capabilityNames,
  effectiveCapabilities,
  parseSearchHealth,
} from './searchHealthContract.generated';
import type { Capability } from './searchHealthContract.generated';

export { healthStatuses } from './searchHealthContract.generated';
export type {
  HealthStatus,
  HealthComponent,
  SearchHealthSnapshot,
} from './searchHealthContract.generated';
export type HealthCapability = Capability;
export type ComponentName = 'clipImage' | 'clipText' | 'faiss' | 'elasticsearch';
export type CapabilityName = 'semanticText' | 'imageSearch' | 'hybridText';
import type { HealthStatus, SearchHealthSnapshot } from './searchHealthContract.generated';

export interface AdminSystemHealth {
  schemaVersion: 1;
  collectedAt: string;
  servedAt: string;
  postgresql: { status: 'READY'; checkedAt: string };
  search: {
    status: HealthStatus;
    errorCode: 'AI_TIMEOUT' | 'AI_UNREACHABLE' | 'AI_INVALID_RESPONSE' | null;
    effectiveCapabilities: Record<CapabilityName, Capability> | null;
    snapshot: SearchHealthSnapshot | null;
  };
}

export interface SystemHealthApi {
  read(signal?: AbortSignal): Promise<AdminSystemHealth>;
}

export type SystemHealthRequester = (
  path: string,
  options: ApiRequestOptions,
) => Promise<unknown>;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const travel = new WeakMap<AdminSystemHealth, number>();
/** Conservative request duration, not a new server timestamp or longer TTL. */
export const healthResponseTravelMs = (response: AdminSystemHealth) => travel.get(response) ?? 0;

function invalid(): never {
  throw new ApiError('Dữ liệu sức khỏe hệ thống không đúng contract; chưa thể hiển thị.', 502);
}

function sameCapabilities(raw: unknown, expected: Record<CapabilityName, Capability>): boolean {
  if (!object(raw) || !exact(raw, capabilityNames)) return false;
  return capabilityNames.every((name) => {
    const value = raw[name];
    const reasons = expected[name].reasonCodes;
    return object(value) && exact(value, ['status', 'reasonCodes']) &&
      value.status === expected[name].status && Array.isArray(value.reasonCodes) &&
      value.reasonCodes.length === reasons.length &&
      new Set(value.reasonCodes).size === value.reasonCodes.length &&
      value.reasonCodes.every((reason) => typeof reason === 'string' && reasons.includes(reason));
  });
}

export function parseAdminSystemHealth(value: unknown): AdminSystemHealth {
  if (!object(value) || !exact(value, ['schemaVersion', 'collectedAt', 'servedAt', 'postgresql', 'search']) ||
    value.schemaVersion !== 1 || !timestamp(value.collectedAt) || !timestamp(value.servedAt) ||
    !object(value.postgresql) || !exact(value.postgresql, ['status', 'checkedAt']) ||
    value.postgresql.status !== 'READY' || !timestamp(value.postgresql.checkedAt) ||
    !object(value.search) || !exact(value.search, ['status', 'errorCode', 'effectiveCapabilities', 'snapshot'])) invalid();
  const search = value.search;
  let snapshot: SearchHealthSnapshot | null = null;
  let capabilities: Record<CapabilityName, Capability> | null = null;
  let aggregate: HealthStatus = 'UNKNOWN';
  let errorCode: AdminSystemHealth['search']['errorCode'] = null;
  if (search.snapshot === null) {
    if (search.status !== 'UNKNOWN' || search.effectiveCapabilities !== null ||
      typeof search.errorCode !== 'string' ||
      !['AI_TIMEOUT', 'AI_UNREACHABLE', 'AI_INVALID_RESPONSE'].includes(search.errorCode)) invalid();
    errorCode = search.errorCode as Exclude<AdminSystemHealth['search']['errorCode'], null>;
  } else {
    if (search.errorCode !== null) invalid();
    try {
      // Canonical producer invariants use server time, not the browser clock.
      snapshot = parseSearchHealth(search.snapshot, Date.parse(value.servedAt));
    } catch {
      invalid();
    }
    capabilities = effectiveCapabilities(snapshot, Date.parse(value.servedAt));
    aggregate = aggregateCapabilities(capabilityNames.map((name) => capabilities![name].status));
    if (!sameCapabilities(search.effectiveCapabilities, capabilities) || search.status !== aggregate) invalid();
  }
  return {
    schemaVersion: 1,
    collectedAt: value.collectedAt,
    servedAt: value.servedAt,
    postgresql: { status: 'READY', checkedAt: value.postgresql.checkedAt },
    search: { status: aggregate, errorCode, effectiveCapabilities: capabilities, snapshot },
  };
}

export function createSystemHealthApi(request: SystemHealthRequester = fetchApi): SystemHealthApi {
  return {
    async read(signal) {
      const version = getAuthSessionVersion();
      const began = performance.now();
      const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
      combined.throwIfAborted();
      try {
        const response = await request('/admin/system-health', {
          method: 'GET', cache: 'no-store', retryOnUnauthorized: false, signal: combined,
        });
        combined.throwIfAborted();
        if (version !== getAuthSessionVersion()) throw new AuthSessionChangedError();
        const parsed = parseAdminSystemHealth(response);
        const elapsed = performance.now() - began;
        // On a broken monotonic clock, fail closed by aging through the maximum TTL.
        travel.set(parsed, Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 60000);
        return parsed;
      } catch (error) {
        if (version !== getAuthSessionVersion()) throw new AuthSessionChangedError();
        throw error;
      }
    },
  };
}
