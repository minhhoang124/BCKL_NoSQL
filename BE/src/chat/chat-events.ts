import { Injectable, Logger } from '@nestjs/common';

export type ChatChange = {
  conversationId: number;
  message?: {
    id: number;
    conversationId: number;
    sequence: number;
    senderId: number;
    senderType: string;
    content: string;
    createdAt: Date;
  };
};

/** Best-effort after-commit delivery; PostgreSQL + sequence catch-up remain authoritative. */
@Injectable()
export class ChatEvents {
  private readonly logger = new Logger(ChatEvents.name);
  private readonly listeners = new Set<(event: ChatChange) => void>();
  subscribe(listener: (event: ChatChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  publish(event: ChatChange) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        this.logger.warn(
          'Chat delivery hint failed; persisted history remains available',
        );
      }
    }
  }
}
