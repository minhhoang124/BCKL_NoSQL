import { HttpException, Injectable } from '@nestjs/common';

/** Shared HTTP/socket ingress budget per actor/instance, never a correctness lock. */
@Injectable()
export class ChatRate {
  private readonly buckets = new Map<
    string,
    { count: number; until: number }
  >();
  consume(actorId: number, group: 'open' | 'send' | 'read') {
    if (process.env.CHAT_TEXT_ENABLED !== 'true')
      throw new HttpException({ code: 'CHAT_NOT_ENABLED' }, 404);
    const now = Date.now();
    for (const [key, bucket] of this.buckets)
      if (bucket.until <= now) this.buckets.delete(key);
    const key = `${actorId}:${group}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= 10000)
        throw new HttpException({ code: 'CHAT_RATE_LIMITED' }, 429);
      bucket = { count: 0, until: now + 60000 };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= { open: 10, send: 20, read: 60 }[group])
      throw new HttpException({ code: 'CHAT_RATE_LIMITED' }, 429);
    bucket.count++;
  }
}
