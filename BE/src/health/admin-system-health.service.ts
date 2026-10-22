import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../prisma.service.js';
import {
  aggregateCapabilities,
  capabilityNames,
  effectiveCapabilities,
  parseSearchHealth,
} from './search-health-contract.js';
import type { SearchHealthSnapshot } from './search-health-contract.js';

type TransportError = 'AI_TIMEOUT' | 'AI_UNREACHABLE' | 'AI_INVALID_RESPONSE';
type Observation = {
  snapshot: SearchHealthSnapshot | null;
  errorCode: TransportError | null;
  collectedAt: string;
};
const BODY_LIMIT = 32768;

@Injectable()
export class AdminSystemHealthService {
  private cache: { observation: Observation; expires: number } | null = null;
  private flight: Promise<Observation> | null = null;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async authorize(actorId: number) {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '2000ms'");
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: { isActive: true, role: true },
        });
        if (!actor?.isActive) throw new UnauthorizedException();
        if (actor.role !== 'ADMIN') throw new ForbiddenException();
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 2000,
        timeout: 3000,
      },
    );
  }

  async read(actorId: number) {
    await this.authorize(actorId); // Authorization is never cached.
    const observation = await this.observe();
    await this.authorize(actorId); // Revocation while waiting must not disclose the cached snapshot.
    const now = Date.now();
    const snapshot =
      observation.snapshot &&
      Date.parse(observation.snapshot.generatedAt) <= now + 5000
        ? observation.snapshot
        : null;
    const capabilities = snapshot ? effectiveCapabilities(snapshot, now) : null;
    return {
      schemaVersion: 1 as const,
      collectedAt: observation.collectedAt,
      servedAt: new Date(now).toISOString(),
      postgresql: {
        status: 'READY' as const,
        checkedAt: new Date(now).toISOString(),
      },
      search: {
        status: capabilities
          ? aggregateCapabilities(
              capabilityNames.map((name) => capabilities[name].status),
            )
          : 'UNKNOWN',
        errorCode:
          observation.snapshot && !snapshot
            ? 'AI_INVALID_RESPONSE'
            : observation.errorCode,
        effectiveCapabilities: capabilities,
        snapshot: snapshot ? structuredClone(snapshot) : null,
      },
    };
  }

  private observe(): Promise<Observation> {
    if (this.cache && performance.now() < this.cache.expires)
      return Promise.resolve(this.cache.observation);
    if (this.flight) return this.flight;
    const flight = this.collect().then((observation) => {
      this.cache = { observation, expires: performance.now() + 15000 };
      return observation;
    });
    this.flight = flight;
    void flight
      .finally(() => {
        if (this.flight === flight) this.flight = null;
      })
      .catch(() => {});
    return flight;
  }

  private async collect(): Promise<Observation> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const base = new URL(
        this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000',
      );
      const token = this.config.get<string>('SEARCH_INTERNAL_HEALTH_TOKEN');
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        !token ||
        token.length > 4096 ||
        [...token].some(
          (char) => char.charCodeAt(0) < 33 || char.charCodeAt(0) > 126,
        )
      )
        throw new Error('unconfigured');
      base.pathname =
        base.pathname.replace(/\/$/, '') + '/internal/health/search';
      const request = (async () => {
        const response = await fetch(base, {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          headers: { 'X-Internal-Health-Token': token },
          signal: controller.signal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new Error('transport');
        }
        if (
          !response.headers
            .get('content-type')
            ?.toLowerCase()
            .startsWith('application/json')
        ) {
          void response.body?.cancel().catch(() => {});
          throw new Error('shape');
        }
        const declared = response.headers.get('content-length');
        if (
          declared !== null &&
          (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)
        ) {
          void response.body?.cancel().catch(() => {});
          throw new Error('shape');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('shape');
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        controller.signal.addEventListener('abort', cancel, { once: true });
        controller.signal.throwIfAborted();
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > BODY_LIMIT) throw new Error('shape');
            chunks.push(part.value);
          }
          return parseSearchHealth(
            JSON.parse(Buffer.concat(chunks).toString('utf8')),
          );
        } catch {
          void reader.cancel().catch(() => {});
          throw new Error('shape');
        } finally {
          controller.signal.removeEventListener('abort', cancel);
          reader.releaseLock();
        }
      })();
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error('timeout'));
        }, 2000);
      });
      const snapshot = await Promise.race([request, deadline]);
      return {
        snapshot,
        errorCode: null,
        collectedAt: new Date().toISOString(),
      };
    } catch (error) {
      controller.abort();
      const errorCode: TransportError = timedOut
        ? 'AI_TIMEOUT'
        : error instanceof Error && error.message === 'shape'
          ? 'AI_INVALID_RESPONSE'
          : 'AI_UNREACHABLE';
      return {
        snapshot: null,
        errorCode,
        collectedAt: new Date().toISOString(),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
