// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../../contexts/useAuth';
import { ApiError } from '../../services/apiClient';
import { AdminSystemHealth } from './AdminSystemHealth';
import { parseAdminSystemHealth } from './systemHealthApi';
import { readyHealth, unknownHealth } from './systemHealth.fixtures';
import {
  parseSearchHealth,
  effectiveCapabilities,
  aggregateCapabilities,
} from './searchHealthContract.generated';

function viewHealth(response: unknown) {
  const api = { read: vi.fn().mockResolvedValue(response) };
  render(<AuthContext.Provider value={{
    user: { id: 8, email: 'review-admin@example.test', role: 'ADMIN', fullName: null, isActive: true },
    loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(),
  }}><AdminSystemHealth api={api} /></AuthContext.Provider>);
  return api;
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Independent PR97 runtime boundary probes', () => {
  it.each([401, 403])('stops automatic polling after authorization error %s', async (code) => {
    vi.useFakeTimers();
    const api = { read: vi.fn().mockRejectedValue(new ApiError('private diagnostic', code)) };
    render(<AuthContext.Provider value={{
      user: { id: 8, email: 'review-admin@example.test', role: 'ADMIN', fullName: null, isActive: true },
      loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(),
    }}><AdminSystemHealth api={api} pollMs={1000} /></AuthContext.Provider>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cập nhật ngay' })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(api.read).toHaveBeenCalledTimes(1);
  });

  it('rejects READY when the transport failed and there is no AI snapshot', () => {
    expect(() => parseAdminSystemHealth({
      ...unknownHealth, search: { ...unknownHealth.search, status: 'READY' },
    })).toThrow(ApiError);
  });

  it('rejects READY aggregate when every effective capability is UNKNOWN', () => {
    const malformed = structuredClone(readyHealth);
    for (const name of ['semanticText', 'imageSearch', 'hybridText'] as const) {
      Object.assign(malformed.search.effectiveCapabilities[name], {
        status: 'UNKNOWN', reasonCodes: ['SNAPSHOT_STALE'],
      });
    }
    expect(() => parseAdminSystemHealth(malformed)).toThrow(ApiError);
  });

  it('expires current Search badges between polls rather than leaving the response READY', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T01:00:59.000Z'));
    const response = structuredClone(readyHealth);
    Object.assign(response, { servedAt: '2026-10-22T01:00:59.000Z' });
    Object.assign(response.postgresql, { checkedAt: response.servedAt });
    const api = viewHealth(response);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getAllByText('Sẵn sàng').length).toBeGreaterThan(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Sẵn sàng')).toHaveLength(1);
  });

  it('does not present expired raw component observations as current READY on a canonical Backend response', async () => {
    const raw = structuredClone(readyHealth.search.snapshot);
    Object.assign(raw, { generatedAt: '2026-10-22T01:00:58.000Z' });
    const snapshot = parseSearchHealth(raw, Date.parse(raw.generatedAt));
    const servedAt = '2026-10-22T01:01:01.000Z';
    const capabilities = effectiveCapabilities(snapshot, Date.parse(servedAt));
    const status = aggregateCapabilities(Object.values(capabilities).map((row) => row.status));
    expect(status).toBe('UNKNOWN');
    expect(snapshot.components.faiss.status).toBe('READY');
    viewHealth({ ...readyHealth, collectedAt: raw.generatedAt, servedAt,
      postgresql: { status: 'READY', checkedAt: servedAt },
      search: { status, errorCode: null, effectiveCapabilities: capabilities, snapshot },
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getAllByText('Sẵn sàng')).toHaveLength(1);
  });

  it('uses elapsed time, not absolute browser clock, and never revives an expired observation after clock rollback', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2040-01-01T00:00:00.000Z'));
    viewHealth(readyHealth);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getAllByText('Sẵn sàng')).toHaveLength(9);
    // A tab resumes after sleep/clock adjustment without waiting for a poll.
    vi.setSystemTime(new Date('2040-01-01T00:02:00.000Z'));
    await act(async () => { fireEvent.focus(window); });
    expect(screen.getAllByText('Sẵn sàng')).toHaveLength(1);
    vi.setSystemTime(new Date('2040-01-01T00:00:00.000Z'));
    await act(async () => { fireEvent.focus(window); });
    expect(screen.getAllByText('Sẵn sàng')).toHaveLength(1);
  });

  it('keeps a pending old-account response out of the next Admin session', async () => {
    let release!: (value: ReturnType<typeof parseAdminSystemHealth>) => void;
    const oldApi = { read: vi.fn(() => new Promise<ReturnType<typeof parseAdminSystemHealth>>((resolve) => { release = resolve; })) };
    const oldAdmin = { id: 8, email: 'old@example.test', role: 'ADMIN' as const, fullName: null, isActive: true };
    const context = { user: oldAdmin, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() };
    const result = render(<AuthContext.Provider value={context}><AdminSystemHealth api={oldApi} /></AuthContext.Provider>);
    const nextApi = { read: vi.fn().mockResolvedValue(unknownHealth) };
    result.rerender(<AuthContext.Provider value={{ ...context, user: { ...oldAdmin, id: 9 } }}>
      <AdminSystemHealth api={nextApi} /></AuthContext.Provider>);
    await act(async () => { release(parseAdminSystemHealth(readyHealth)); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('Không kết nối được AI service')).toBeVisible();
    expect(screen.queryByText('86')).not.toBeInTheDocument();
  });
});
