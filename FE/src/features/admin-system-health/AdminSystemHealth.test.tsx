// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../../contexts/useAuth';
import { ApiError } from '../../services/apiClient';
import type { User } from '../../types/auth';
import { AdminSystemHealth } from './AdminSystemHealth';
import type { AdminSystemHealth as HealthResponse, SystemHealthApi } from './systemHealthApi';
import { readyHealth, unknownHealth } from './systemHealth.fixtures';
import { parseAdminSystemHealth } from './systemHealthApi';
import { aggregateCapabilities, effectiveCapabilities } from './searchHealthContract.generated';

const admin: User = { id: 8, email: 'admin@example.test', fullName: 'Admin QA', role: 'ADMIN', isActive: true };
afterEach(() => cleanup());
function view(api: SystemHealthApi | undefined, user: User | null = admin) {
  return render(<AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}>
    <AdminSystemHealth api={api} embedded />
  </AuthContext.Provider>);
}

describe('Admin system health screen', () => {
  it('does not request health for non-Admin actors', () => {
    const api = { read: vi.fn() };
    view(api, { ...admin, role: 'USER' });
    expect(screen.getByRole('alert')).toHaveTextContent('Cần tài khoản Admin');
    expect(api.read).not.toHaveBeenCalled();
  });

  it('shows transport UNKNOWN without inventing component states or quality claims', async () => {
    const api = { read: vi.fn().mockResolvedValue(unknownHealth) };
    view(api);
    expect(await screen.findByText('Không kết nối được AI service')).toBeVisible();
    expect(screen.getByText('Chưa có snapshot AI hợp lệ; không suy đoán trạng thái từng nhánh.')).toBeVisible();
    expect(screen.getByText(/không chứng minh outbox đã đồng bộ hết/i)).toBeVisible();
  });

  it('renders all capabilities and refreshes only through the supplied Backend adapter', async () => {
    const api = { read: vi.fn().mockResolvedValue(readyHealth) };
    view(api);
    expect(await screen.findByText('Tìm kiếm kết hợp')).toBeVisible();
    expect(screen.getByText('FAISS')).toBeVisible();
    expect(screen.getByText('86')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật ngay' }));
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
  });

  it('blocks further reads after the Backend denies current Admin access', async () => {
    const api = { read: vi.fn().mockRejectedValue(new ApiError('private', 403)) };
    view(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('không có quyền xem sức khỏe hệ thống');
    expect(screen.getByRole('button', { name: 'Cập nhật ngay' })).toBeDisabled();
    expect(screen.queryByText('private')).not.toBeInTheDocument();
  });

  it('keeps loading distinct from an empty or healthy response', () => {
    const api = { read: vi.fn(() => new Promise<never>(() => {})) };
    view(api);
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải sức khỏe hệ thống');
    expect(screen.queryByText('Sẵn sàng')).not.toBeInTheDocument();
  });

  it('renders stale and empty-index evidence without claiming synchronization', async () => {
    const stale = structuredClone(readyHealth) as unknown as HealthResponse;
    stale.search.status = 'UNKNOWN';
    stale.search.effectiveCapabilities!.semanticText = { status: 'UNKNOWN', reasonCodes: ['SNAPSHOT_STALE'] };
    stale.search.snapshot!.components.faiss.status = 'UNKNOWN';
    stale.search.snapshot!.components.faiss.errorCode = 'SNAPSHOT_STALE';
    const api = { read: vi.fn().mockResolvedValue(stale) };
    const result = view(api);
    expect(await screen.findAllByText('Kết quả đã hết hạn')).not.toHaveLength(0);
    result.unmount();

    const empty = structuredClone(readyHealth) as unknown as HealthResponse;
    empty.search.snapshot!.components.faiss.vectorCount = 0;
    empty.search.snapshot!.components.faiss.warningCodes = ['EMPTY_INDEX'];
    view({ read: vi.fn().mockResolvedValue(empty) });
    expect(await screen.findByText('Index đang trống')).toBeVisible();
    expect(screen.getByText('0')).toBeVisible();
  });

  it.each([
    ['DEGRADED', 'Suy giảm'],
    ['UNAVAILABLE', 'Không khả dụng'],
  ] as const)('renders the Backend aggregate %s state without rewriting it', async (status, label) => {
    const response = structuredClone(readyHealth) as unknown as HealthResponse;
    // Model a real canonical observation, not only a contradictory top-level
    // status. All capabilities depend on FAISS; healthy raw data must not be
    // mislabeled degraded/unavailable solely because a fixture says so.
    const faiss = response.search.snapshot!.components.faiss;
    faiss.status = status;
    if (status === 'DEGRADED') {
      faiss.vectorCount = 0;
      faiss.warningCodes = ['EMPTY_INDEX'];
    } else {
      faiss.errorCode = 'INDEX_SEARCH_FAILED';
    }
    response.search.snapshot!.capabilities = effectiveCapabilities(response.search.snapshot!, Date.parse(response.search.snapshot!.generatedAt));
    response.search.effectiveCapabilities = effectiveCapabilities(response.search.snapshot!, Date.parse(response.servedAt));
    response.search.status = aggregateCapabilities(Object.values(response.search.effectiveCapabilities).map((row) => row.status));
    view({ read: vi.fn().mockResolvedValue(parseAdminSystemHealth(response)) });
    expect((await screen.findAllByText(label)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(status === 'DEGRADED' ? 'Index đang trống' : 'Không đọc được index').length).toBeGreaterThanOrEqual(1);
  });
});
