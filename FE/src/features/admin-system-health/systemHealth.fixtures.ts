export const unknownHealth = {
  schemaVersion: 1,
  collectedAt: '2026-10-22T01:00:00.000Z',
  servedAt: '2026-10-22T01:00:01.000Z',
  postgresql: { status: 'READY', checkedAt: '2026-10-22T01:00:01.000Z' },
  search: {
    status: 'UNKNOWN', errorCode: 'AI_UNREACHABLE', effectiveCapabilities: null, snapshot: null,
  },
} as const;

const component = (overrides: Record<string, unknown> = {}) => ({
  loaded: true, status: 'READY', checkedAt: '2026-10-22T01:00:00.000Z',
  expiresAt: '2026-10-22T01:01:00.000Z', lastSuccessAt: '2026-10-22T01:00:00.000Z',
  durationMs: 12, errorCode: null, warningCodes: [], dimension: 512, ...overrides,
});

export const readyHealth = {
  ...unknownHealth,
  search: {
    status: 'READY', errorCode: null,
    effectiveCapabilities: {
      semanticText: { status: 'READY', reasonCodes: [] }, imageSearch: { status: 'READY', reasonCodes: [] },
      hybridText: { status: 'READY', reasonCodes: [] },
    },
    snapshot: {
      schemaVersion: 1, generatedAt: '2026-10-22T01:00:01.000Z',
      components: {
        clipImage: component(), clipText: component(),
        faiss: component({ vectorCount: 86 }),
        elasticsearch: {
          loaded: null, status: 'READY', checkedAt: '2026-10-22T01:00:00.000Z',
          expiresAt: '2026-10-22T01:01:00.000Z', lastSuccessAt: '2026-10-22T01:00:00.000Z',
          durationMs: 12, errorCode: null, warningCodes: [], indexExists: true, readable: true,
        },
      },
      capabilities: {
        semanticText: { status: 'READY', reasonCodes: [] }, imageSearch: { status: 'READY', reasonCodes: [] },
        hybridText: { status: 'READY', reasonCodes: [] },
      },
    },
  },
} as const;
