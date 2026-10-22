import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aggregateCapabilities,
  effectiveCapabilities,
  parseSearchHealth,
} from './search-health-contract.js';
import type { SearchHealthSnapshot } from './search-health-contract.js';
const fixture = () =>
  JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../docs/api/examples/search-health-proposed-v1.json',
      ),
      'utf8',
    ),
  ) as SearchHealthSnapshot;
const now = Date.parse('2026-10-16T06:00:01.000Z');

describe('Canonical Search health wire validator', () => {
  it('expiry replaces a previous UNKNOWN reason as well as a previous failure', () => {
    const value = fixture();
    value.components.faiss.status = 'UNKNOWN';
    value.components.faiss.errorCode = 'PROBE_TIMEOUT';
    value.capabilities.semanticText = {
      status: 'UNKNOWN',
      reasonCodes: ['PROBE_TIMEOUT'],
    };
    value.capabilities.imageSearch = {
      status: 'UNKNOWN',
      reasonCodes: ['PROBE_TIMEOUT'],
    };
    const parsed = parseSearchHealth(value, now);
    expect(effectiveCapabilities(parsed, now + 60000).semanticText).toEqual({
      status: 'UNKNOWN',
      reasonCodes: ['SNAPSHOT_STALE'],
    });
  });
  it('accepts the checked-in Pydantic contract fixture without inventing overall readiness', () => {
    const value = parseSearchHealth(fixture(), now);
    expect(
      aggregateCapabilities(
        Object.values(value.capabilities).map((cap) => cap.status),
      ),
    ).toBe('DEGRADED');
    expect(value.capabilities.hybridText.status).toBe('UNAVAILABLE');
  });
  const invalid: [string, (value: SearchHealthSnapshot) => void][] = [
    [
      'extra envelope',
      (value) => {
        Object.assign(value, { debug: 'private' });
      },
    ],
    [
      'missing component',
      (value) => {
        Reflect.deleteProperty(value.components, 'faiss');
      },
    ],
    [
      'extra metadata',
      (value) => {
        Object.assign(value.components.faiss, { indexPath: '/private' });
      },
    ],
    [
      'boolean version',
      (value) => {
        Object.assign(value, { schemaVersion: true });
      },
    ],
    [
      'nonfinite duration',
      (value) => {
        value.components.clipText.durationMs = Infinity;
      },
    ],
    [
      'negative duration',
      (value) => {
        value.components.clipText.durationMs = -1;
      },
    ],
    [
      'unsafe vector count',
      (value) => {
        value.components.faiss.vectorCount = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'zero dimension',
      (value) => {
        value.components.faiss.dimension = 0;
      },
    ],
    [
      'invalid calendar date',
      (value) => {
        value.generatedAt = '2026-02-31T06:00:01.000Z';
      },
    ],
    [
      'non UTC timestamp',
      (value) => {
        value.generatedAt = '2026-10-16T06:00:01+00:00';
      },
    ],
    [
      'future producer clock',
      (value) => {
        value.generatedAt = '2026-10-16T06:00:07.000Z';
      },
    ],
    [
      'unpaired observation',
      (value) => {
        value.components.faiss.checkedAt = null;
      },
    ],
    [
      'TTL above 60 seconds',
      (value) => {
        value.components.faiss.expiresAt = '2026-10-16T06:01:00.001Z';
      },
    ],
    [
      'expires at observation',
      (value) => {
        value.components.faiss.expiresAt = value.components.faiss.checkedAt;
      },
    ],
    [
      'success later than observation',
      (value) => {
        value.components.faiss.lastSuccessAt = value.generatedAt;
      },
    ],
    [
      'usable but unloaded',
      (value) => {
        value.components.faiss.loaded = false;
      },
    ],
    [
      'usable without measurement',
      (value) => {
        value.components.faiss.durationMs = null;
      },
    ],
    [
      'CLIP warnings undefined',
      (value) => {
        value.components.clipText.warningCodes = ['EMPTY_INDEX'];
      },
    ],
    [
      'FAISS ES warning',
      (value) => {
        value.components.faiss.warningCodes = ['ES_REPLICA_WARNING'];
      },
    ],
    [
      'FAISS empty count mismatch',
      (value) => {
        value.components.faiss.vectorCount = 0;
      },
    ],
    [
      'unknown reason',
      (value) => {
        value.components.elasticsearch.errorCode = 'RAW_EXCEPTION';
      },
    ],
    [
      'uncertainty labeled failure',
      (value) => {
        value.components.elasticsearch.errorCode = 'PROBE_TIMEOUT';
      },
    ],
    [
      'ES loaded flag',
      (value) => {
        value.components.elasticsearch.loaded = true;
      },
    ],
    [
      'invented capability reason',
      (value) => {
        value.capabilities.hybridText.reasonCodes = ['MODEL_NOT_LOADED'];
      },
    ],
    [
      'duplicate reason',
      (value) => {
        value.capabilities.hybridText.reasonCodes = [
          'ES_TIMEOUT',
          'ES_TIMEOUT',
        ];
      },
    ],
    [
      'false healthy hybrid',
      (value) => {
        value.capabilities.hybridText = { status: 'READY', reasonCodes: [] };
      },
    ],
    [
      'expired failure not unknown',
      (value) => {
        value.generatedAt = '2026-10-16T06:01:00.000Z';
      },
    ],
    [
      'dimension mismatch without explicit reason',
      (value) => {
        value.components.clipText.dimension = 1024;
      },
    ],
  ];
  it.each(invalid)('rejects %s', (_name, mutate) => {
    const value = fixture();
    mutate(value);
    expect(() => parseSearchHealth(value, now)).toThrow(
      'Invalid Search health response',
    );
  });
  it('accepts empty FAISS as read-ready with a warning, not proof of synchronization', () => {
    const value = fixture();
    value.components.faiss.vectorCount = 0;
    value.components.faiss.warningCodes = ['EMPTY_INDEX'];
    expect(parseSearchHealth(value, now).components.faiss.status).toBe('READY');
  });
  it('consumer expiry does not rewrite observations or resurrect an old dimension mismatch', () => {
    const value = fixture();
    value.components.clipText.dimension = 1024;
    value.capabilities.semanticText = {
      status: 'UNAVAILABLE',
      reasonCodes: ['DIMENSION_MISMATCH'],
    };
    value.capabilities.hybridText.reasonCodes.push('DIMENSION_MISMATCH');
    const parsed = parseSearchHealth(value, now);
    const copy = structuredClone(parsed);
    const result = effectiveCapabilities(parsed, now + 60000);
    expect(result.semanticText).toEqual({
      status: 'UNKNOWN',
      reasonCodes: ['SNAPSHOT_STALE'],
    });
    expect(result.hybridText.status).toBe('UNKNOWN');
    expect(parsed).toEqual(copy);
  });
  it('a fresh ES failure still wins over expired model observations for hybrid', () => {
    const value = fixture();
    value.components.clipText.expiresAt = '2026-10-16T06:00:02.000Z';
    const parsed = parseSearchHealth(value, now);
    const result = effectiveCapabilities(parsed, now + 2000);
    expect(result.semanticText.status).toBe('UNKNOWN');
    expect(result.hybridText).toEqual({
      status: 'UNAVAILABLE',
      reasonCodes: ['SNAPSHOT_STALE', 'ES_TIMEOUT'],
    });
  });
  it('fully degraded but usable capabilities aggregate to DEGRADED', () => {
    expect(aggregateCapabilities(['DEGRADED', 'DEGRADED', 'DEGRADED'])).toBe(
      'DEGRADED',
    );
    expect(
      aggregateCapabilities(['UNAVAILABLE', 'UNKNOWN', 'UNAVAILABLE']),
    ).toBe('UNKNOWN');
    expect(
      aggregateCapabilities(['UNAVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE']),
    ).toBe('UNAVAILABLE');
  });
});
