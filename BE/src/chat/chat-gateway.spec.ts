import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { PrismaService } from '../prisma.service.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatService } from './chat.service.js';
import { ChatEvents } from './chat-events.js';
import { ChatRate } from './chat-rate.js';

describe('Chat gateway controlled lifecycle/expiry schedules', () => {
  let gateway: ChatGateway;
  const old = process.env.CHAT_TEXT_ENABLED;
  const user = { id: 2, isActive: true, role: 'USER', credentialVersion: 1 };
  const lookup = vi.fn(),
    detail = vi.fn();
  function socket() {
    const raw = {
      id: 'qa-socket',
      connected: true,
      handshake: { auth: { token: 'qa' }, headers: {}, query: {} },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    const result = raw as unknown as Socket;
    raw.disconnect.mockImplementation(() => {
      raw.connected = false;
      gateway.handleDisconnect(result);
    });
    return result;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'));
    process.env.CHAT_TEXT_ENABLED = 'true';
    lookup.mockReset().mockResolvedValue(user);
    detail.mockReset().mockResolvedValue({ id: 7 });
    gateway = new ChatGateway(
      { detail } as unknown as ChatService,
      new ChatEvents(),
      new ChatRate(),
      {
        verifyAsync: vi.fn().mockResolvedValue({
          sub: 2,
          cv: 1,
          type: 'access',
          exp: Date.now() / 1000 + 1,
        }),
      } as unknown as JwtService,
      { user: { findUnique: lookup } } as unknown as PrismaService,
      {
        getOrThrow: () => 'qa',
        get: (_key: string, value: string) => value,
      } as unknown as ConfigService,
    );
  });
  afterEach(() => {
    gateway.onModuleDestroy();
    vi.useRealTimers();
    if (old === undefined) delete process.env.CHAT_TEXT_ENABLED;
    else process.env.CHAT_TEXT_ENABLED = old;
  });
  it('never emits ready when token expires while the first DB lookup is pending', async () => {
    let release!: (value: typeof user) => void;
    lookup.mockReturnValue(
      new Promise((done) => {
        release = done;
      }),
    );
    const client = socket(),
      connecting = gateway.handleConnection(client);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1500);
    release(user);
    await connecting;
    expect(client.emit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });
  it('does not repopulate peers/timers when a pending handshake completes after destroy', async () => {
    let release!: (value: typeof user) => void;
    lookup.mockReturnValue(
      new Promise((done) => {
        release = done;
      }),
    );
    const client = socket(),
      connecting = gateway.handleConnection(client);
    await Promise.resolve();
    await Promise.resolve();
    gateway.onModuleDestroy();
    release(user);
    await connecting;
    expect(client.emit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('a completed leave fences an older slow join on the same socket', async () => {
    const client = socket();
    await gateway.handleConnection(client);
    let release!: (value: { id: number }) => void;
    detail.mockReturnValue(
      new Promise((done) => {
        release = done;
      }),
    );
    const joining = gateway.join(client, { conversationId: 7 });
    await vi.waitFor(() => expect(detail).toHaveBeenCalled());
    expect((await gateway.leave(client, { conversationId: 7 })).ok).toBe(true);
    release({ id: 7 });
    await joining;
    const peers = (
      gateway as unknown as { peers: Map<string, { conversationId?: number }> }
    ).peers;
    expect(peers.get(client.id)?.conversationId).toBeUndefined();
  });
  it('does not return successful action data after credentials are revoked during its DB wait', async () => {
    const client = socket();
    await gateway.handleConnection(client);
    let release!: (value: { id: number }) => void;
    detail.mockReturnValue(
      new Promise((done) => {
        release = done;
      }),
    );
    const joining = gateway.join(client, { conversationId: 7 });
    await vi.waitFor(() => expect(detail).toHaveBeenCalled());
    lookup.mockResolvedValue({ ...user, credentialVersion: 2 });
    release({ id: 7 });
    expect((await joining).ok).toBe(false);
    expect(client.disconnect).toHaveBeenCalled();
  });
});
