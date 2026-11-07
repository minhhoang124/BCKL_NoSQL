import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '../contexts/useAuth';
import { AdminSystemHealth } from '../features/admin-system-health/AdminSystemHealth';
import type { AdminSystemHealth as HealthResponse, HealthStatus, SystemHealthApi } from '../features/admin-system-health/systemHealthApi';
import { readyHealth, unknownHealth } from '../features/admin-system-health/systemHealth.fixtures';
import { ApiError } from '../services/apiClient';
import type { User } from '../types/auth';
import '../index.css';

type Mode = 'ready' | 'degraded' | 'unavailable' | 'unknown' | 'stale' | 'empty' | 'loading' | 'permission';
const modes: Mode[] = ['ready', 'degraded', 'unavailable', 'unknown', 'stale', 'empty', 'loading', 'permission'];
const modeLabels: Record<Mode, string> = {
  ready: 'READY', degraded: 'DEGRADED', unavailable: 'UNAVAILABLE', unknown: 'UNKNOWN / AI mất kết nối',
  stale: 'Snapshot hết hạn', empty: 'Index trống', loading: 'Loading', permission: 'Lỗi quyền',
};
const admin: User = { id: 999999, email: 'admin-fixture@example.invalid', fullName: 'Admin PREPARATION', role: 'ADMIN', isActive: true };

function cloneReady(): HealthResponse { return structuredClone(readyHealth) as unknown as HealthResponse; }
function statusFixture(status: Exclude<HealthStatus, 'READY'>): HealthResponse {
  const value = cloneReady();
  value.search.status = status;
  const capabilityReasons = {
    semanticText: status === 'DEGRADED' ? ['MODEL_NOT_LOADED'] : ['AI_UNREACHABLE'],
    imageSearch: status === 'DEGRADED' ? ['EMPTY_INDEX'] : ['INDEX_NOT_LOADED'],
    hybridText: status === 'DEGRADED' ? ['ES_REPLICA_WARNING'] : ['ES_UNREACHABLE'],
  } as const;
  for (const name of ['semanticText', 'imageSearch', 'hybridText'] as const) {
    value.search.effectiveCapabilities![name] = { status, reasonCodes: [...capabilityReasons[name]] };
    value.search.snapshot!.capabilities[name] = { status, reasonCodes: [...capabilityReasons[name]] };
  }
  const componentReasons = {
    clipImage: status === 'DEGRADED' ? 'MODEL_NOT_LOADED' : 'AI_UNREACHABLE',
    clipText: status === 'DEGRADED' ? 'MODEL_NOT_LOADED' : 'AI_UNREACHABLE',
    faiss: status === 'DEGRADED' ? 'EMPTY_INDEX' : 'INDEX_NOT_LOADED',
    elasticsearch: status === 'DEGRADED' ? 'ES_REPLICA_WARNING' : 'ES_UNREACHABLE',
  } as const;
  for (const name of ['clipImage', 'clipText', 'faiss', 'elasticsearch'] as const) {
    const row = value.search.snapshot!.components[name];
    row.status = status;
    row.errorCode = status === 'DEGRADED' ? null : componentReasons[name];
    row.warningCodes = status === 'DEGRADED' ? [componentReasons[name]] : [];
  }
  return value;
}
function fixture(mode: Mode): HealthResponse | null {
  if (mode === 'ready') return cloneReady();
  if (mode === 'unknown') return structuredClone(unknownHealth) as unknown as HealthResponse;
  if (mode === 'degraded') return statusFixture('DEGRADED');
  if (mode === 'unavailable') return statusFixture('UNAVAILABLE');
  if (mode === 'stale') {
    const value = statusFixture('UNKNOWN');
    value.search.errorCode = null;
    for (const name of ['semanticText', 'imageSearch', 'hybridText'] as const) {
      value.search.effectiveCapabilities![name].reasonCodes = ['SNAPSHOT_STALE'];
      value.search.snapshot!.capabilities[name].reasonCodes = ['SNAPSHOT_STALE'];
    }
    for (const row of Object.values(value.search.snapshot!.components)) row.errorCode = 'SNAPSHOT_STALE';
    return value;
  }
  if (mode === 'empty') {
    const value = cloneReady();
    const faiss = value.search.snapshot!.components.faiss;
    faiss.status = 'DEGRADED';
    faiss.vectorCount = 0;
    faiss.warningCodes = ['EMPTY_INDEX'];
    value.search.status = 'DEGRADED';
    value.search.effectiveCapabilities!.imageSearch = { status: 'DEGRADED', reasonCodes: ['EMPTY_INDEX'] };
    value.search.snapshot!.capabilities.imageSearch = { status: 'DEGRADED', reasonCodes: ['EMPTY_INDEX'] };
    return value;
  }
  return null;
}

export function Preview() {
  const initial = new URLSearchParams(window.location.search).get('mode') as Mode | null;
  const [mode, setMode] = useState<Mode>(initial && modes.includes(initial) ? initial : 'ready');
  const api = useMemo<SystemHealthApi>(() => ({ read: () => {
    if (mode === 'loading') return new Promise<HealthResponse>(() => {});
    if (mode === 'permission') return Promise.reject(new ApiError('fixture permission', 403));
    return Promise.resolve(fixture(mode)!);
  } }), [mode]);
  return <AuthContext.Provider value={{ user: admin, loading: false, login: () => {}, logout: async () => {}, refresh: async () => {} }}>
    <div style={{ boxSizing: 'border-box', width: '100%', maxWidth: '100%', colorScheme: 'light', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, background: '#fff7f1', color: '#20242b', borderBottom: '2px solid #b83208', padding: 12, font: '14px Segoe UI, sans-serif', overflowWrap: 'anywhere' }}>
      <strong style={{ maxWidth: '100%' }}>PREPARATION FIXTURE — KHÔNG PHẢI DỮ LIỆU LIVE</strong>{' · '}
      <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>Trạng thái minh họa: <select aria-label="Trạng thái fixture Search Health" value={mode}
        onChange={(event) => setMode(event.target.value as Mode)} style={{ minHeight: 40, maxWidth: '100%', color: '#20242b', background: '#fff' }}>
        {modes.map(value => <option key={value} value={value}>{modeLabels[value]}</option>)}
      </select></label>
    </div>
    <main style={{ boxSizing: 'border-box', width: '100%', maxWidth: '100%', background: '#f6f7f8', minHeight: '100svh', minWidth: 0, overflowX: 'clip', padding: 'clamp(14px, 4vw, 36px)' }}>
      <AdminSystemHealth key={mode} api={api} pollMs={30000} />
    </main>
  </AuthContext.Provider>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(import.meta.env.DEV ? <StrictMode><Preview /></StrictMode> : <p>Preview chỉ dùng trong môi trường phát triển.</p>);
