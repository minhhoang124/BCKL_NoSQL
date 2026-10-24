import { HttpException, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { PrismaService } from '../prisma.service.js';
import { credentialMatches } from '../auth/credential-version.js';
import type { JwtPayload } from '../auth/auth.types.js';
import { ChatService } from './chat.service.js';
import { ChatEvents, type ChatChange } from './chat-events.js';
import { ChatRate } from './chat-rate.js';
import { ChatMessageRequestError } from './chat-message-request.js';
import { ChatPolicyError } from './chat-policy.js';

const reject = (status: number, code: string): never => {
  throw new HttpException({ code }, status);
};
function object(body: unknown, keys: string[]): Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).sort().join() !== keys.sort().join()
  )
    return reject(400, 'CHAT_VALIDATION_ERROR');
  return body as Record<string, unknown>;
}
function id(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    return reject(400, 'CHAT_VALIDATION_ERROR');
  return value;
}
export function chatOriginAllowed(origin: string | undefined) {
  return (
    !origin || origin === (process.env.FRONTEND_URL || 'http://localhost:5173')
  );
}

@WebSocketGateway({
  namespace: '/chat',
  transports: ['websocket'],
  maxHttpBufferSize: 16384,
  cors: {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => callback(null, chatOriginAllowed(origin)),
    credentials: true,
  },
  allowRequest: (
    req: { headers: { origin?: string } },
    callback: (error: string | null, allowed: boolean) => void,
  ) => callback(null, chatOriginAllowed(req.headers.origin)),
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly peers = new Map<
    string,
    {
      socket: Socket;
      actorId: number;
      conversationId?: number;
      subscription: number;
      expiry: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly unsubscribe: () => void;
  private readonly sweep: ReturnType<typeof setInterval>;
  private checking = false;
  private destroyed = false;
  private readonly pending = new Set<Socket>();
  private readonly deliveries = new Map<number, ChatChange>();
  private delivering = false;
  constructor(
    private readonly chat: ChatService,
    private readonly events: ChatEvents,
    private readonly rate: ChatRate,
    private readonly jwt: JwtService,
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.unsubscribe = events.subscribe((event) => {
      if (this.destroyed) return;
      // Bounded/coalesced hints; the client always fetches all missing sequences.
      if (
        this.deliveries.size >= 1000 &&
        !this.deliveries.has(event.conversationId)
      )
        return;
      this.deliveries.set(event.conversationId, event);
      void this.drain();
    });
    this.sweep = setInterval(() => {
      void this.checkPeers();
    }, 10000);
    this.sweep.unref();
  }
  private async authenticate(socket: Socket) {
    if (process.env.CHAT_TEXT_ENABLED !== 'true')
      return reject(404, 'CHAT_NOT_ENABLED');
    if (!chatOriginAllowed(socket.handshake.headers.origin))
      return reject(403, 'FORBIDDEN');
    const token = socket.handshake.auth?.token;
    if (
      typeof token !== 'string' ||
      token.length > 8192 ||
      socket.handshake.query.token !== undefined
    )
      return reject(401, 'UNAUTHORIZED');
    let payload: JwtPayload & { exp?: number };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
        issuer: this.config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: this.config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
      });
    } catch {
      return reject(401, 'UNAUTHORIZED');
    }
    if (
      payload.type !== 'access' ||
      !Number.isInteger(payload.sub) ||
      payload.sub < 1 ||
      !Number.isInteger(payload.exp) ||
      payload.exp! * 1000 <= Date.now()
    )
      return reject(401, 'UNAUTHORIZED');
    const actor = await this.db.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true, role: true, credentialVersion: true },
    });
    if (
      this.destroyed ||
      payload.exp! * 1000 <= Date.now() ||
      !actor?.isActive ||
      !credentialMatches(payload.cv, actor.credentialVersion)
    )
      return reject(401, 'UNAUTHORIZED');
    if (actor.role === 'ADMIN') return reject(403, 'FORBIDDEN');
    return {
      actorId: actor.id,
      expires: payload.exp! * 1000,
      credentialVersion: actor.credentialVersion,
    };
  }
  async handleConnection(socket: Socket) {
    if (this.destroyed || this.pending.size >= 32 || this.peers.size >= 1000)
      return socket.disconnect(true);
    this.pending.add(socket);
    try {
      const actor = await this.authenticate(socket);
      if (
        this.destroyed ||
        actor.expires <= Date.now() ||
        !socket.connected ||
        this.peers.size >= 1000 ||
        [...this.peers.values()].filter((p) => p.actorId === actor.actorId)
          .length >= 5
      )
        return socket.disconnect(true);
      this.rate.consume(actor.actorId, 'read');
      const expiry = setTimeout(
        () => socket.disconnect(true),
        Math.min(actor.expires - Date.now(), 2147483647),
      );
      expiry.unref();
      this.peers.set(socket.id, {
        socket,
        actorId: actor.actorId,
        expiry,
        subscription: 0,
      });
      socket.emit('chat:ready', { authenticated: true });
    } catch {
      socket.disconnect(true);
    } finally {
      this.pending.delete(socket);
    }
  }
  handleDisconnect(socket: Socket) {
    const peer = this.peers.get(socket.id);
    if (peer) clearTimeout(peer.expiry);
    this.peers.delete(socket.id);
  }
  private async action(
    socket: Socket,
    group: 'read' | 'send',
    run: (actorId: number) => Promise<unknown>,
  ) {
    try {
      const actor = await this.authenticate(socket);
      if (!this.peers.has(socket.id)) return reject(401, 'UNAUTHORIZED');
      this.rate.consume(actor.actorId, group);
      const data = await run(actor.actorId);
      await this.authenticate(socket);
      if (!socket.connected || this.destroyed)
        return reject(401, 'UNAUTHORIZED');
      return { ok: true, data };
    } catch (error) {
      const status =
        error instanceof HttpException
          ? error.getStatus()
          : error instanceof ChatMessageRequestError ||
              error instanceof ChatPolicyError
            ? error.status
            : 500;
      const response =
        error instanceof HttpException ? error.getResponse() : undefined;
      const code =
        error instanceof ChatMessageRequestError ||
        error instanceof ChatPolicyError
          ? error.code
          : response && typeof response === 'object' && 'code' in response
            ? String(response.code)
            : status === 500
              ? 'CHAT_UNAVAILABLE'
              : 'CHAT_VALIDATION_ERROR';
      if ([401, 403].includes(status)) socket.disconnect(true);
      return { ok: false, error: { status, code } };
    }
  }
  @SubscribeMessage('conversation:join')
  join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const pendingPeer = this.peers.get(socket.id);
    const subscription = pendingPeer ? ++pendingPeer.subscription : -1;
    return this.action(socket, 'read', async (actorId) => {
      const conversationId = id(
        object(body, ['conversationId']).conversationId,
      );
      const detail = await this.chat.detail(actorId, conversationId);
      const peer = this.peers.get(socket.id);
      if (peer && socket.connected && peer.subscription === subscription)
        peer.conversationId = conversationId;
      return detail;
    });
  }
  @SubscribeMessage('conversation:leave')
  leave(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const pendingPeer = this.peers.get(socket.id);
    if (pendingPeer) ++pendingPeer.subscription;
    return this.action(socket, 'read', async () => {
      const conversationId = id(
        object(body, ['conversationId']).conversationId,
      );
      const peer = this.peers.get(socket.id);
      if (peer?.conversationId === conversationId)
        peer.conversationId = undefined;
      return { conversationId };
    });
  }
  @SubscribeMessage('message:send')
  send(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.action(socket, 'send', async (actorId) => {
      const data = object(body, ['conversationId', 'message']);
      return this.chat.send(actorId, id(data.conversationId), data.message);
    });
  }
  @SubscribeMessage('conversation:read')
  read(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.action(socket, 'read', async (actorId) => {
      const data = object(body, ['conversationId', 'lastReadMessageId']);
      return this.chat.read(
        actorId,
        id(data.conversationId),
        id(data.lastReadMessageId),
      );
    });
  }
  private async deliver(event: ChatChange) {
    await this.bounded(
      [...this.peers.values()].filter(
        (p) => p.conversationId === event.conversationId,
      ),
      async (peer) => {
        try {
          const actor = await this.authenticate(peer.socket);
          await this.chat.authorizeDelivery(
            peer.actorId,
            event.conversationId,
            actor.credentialVersion,
            actor.expires,
            () => {
              if (
                this.destroyed ||
                !peer.socket.connected ||
                peer.conversationId !== event.conversationId
              )
                return;
              const message = event.message;
              peer.socket.emit(
                event.message ? 'message:created' : 'conversation:updated',
                message
                  ? {
                      id: message.id,
                      conversationId: message.conversationId,
                      sequence: message.sequence,
                      senderId: message.senderId,
                      senderType: message.senderType,
                      content: message.content,
                      createdAt: message.createdAt,
                    }
                  : { conversationId: event.conversationId },
              );
            },
          );
        } catch {
          peer.socket.disconnect(true);
        }
      },
    );
  }
  private async bounded<T>(items: T[], run: (item: T) => Promise<void>) {
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, items.length) }, async () => {
        while (!this.destroyed && index < items.length)
          await run(items[index++]);
      }),
    );
  }
  private async drain() {
    if (this.delivering || this.destroyed) return;
    this.delivering = true;
    try {
      while (!this.destroyed && this.deliveries.size) {
        const [key, event] = this.deliveries.entries().next().value!;
        this.deliveries.delete(key);
        await this.deliver(event);
      }
    } finally {
      this.delivering = false;
    }
  }
  private async checkPeers() {
    if (this.checking) return;
    this.checking = true;
    try {
      await this.bounded([...this.peers.values()], async (peer) => {
        try {
          await this.authenticate(peer.socket);
          if (peer.conversationId)
            await this.chat.detail(peer.actorId, peer.conversationId);
        } catch {
          peer.socket.disconnect(true);
        }
      });
    } finally {
      this.checking = false;
    }
  }
  onModuleDestroy() {
    this.destroyed = true;
    clearInterval(this.sweep);
    this.unsubscribe();
    this.deliveries.clear();
    for (const socket of this.pending) socket.disconnect(true);
    this.pending.clear();
    for (const peer of this.peers.values()) {
      clearTimeout(peer.expiry);
      peer.socket.disconnect(true);
    }
    this.peers.clear();
  }
}
