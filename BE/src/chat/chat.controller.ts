import {
  ArgumentsHost,
  Body,
  CanActivate,
  Catch,
  Controller,
  ExceptionFilter,
  ExecutionContext,
  Get,
  HttpException,
  Injectable,
  Module,
  NestModule,
  MiddlewareConsumer,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ChatMessageRequestError } from './chat-message-request.js';
import { ChatPolicyError } from './chat-policy.js';
import { ChatService } from './chat.service.js';
import { chatInboxPage } from './chat-inbox-page.js';
import { ChatEvents } from './chat-events.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatRate } from './chat-rate.js';

const invalid = (): never => {
  throw new ChatMessageRequestError(400, 'CHAT_VALIDATION_ERROR');
};
function integer(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,9}$/.test(value) ||
    Number(value) > 2147483647
  )
    return invalid();
  return Number(value);
}
function bodyId(body: unknown, key: string): number {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).join(',') !== key
  )
    return invalid();
  const value = (body as Record<string, unknown>)[key];
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    return invalid();
  return value;
}
export function chatPage(url: string, history: boolean) {
  const params = new URL(url, 'http://local.invalid').searchParams;
  const allowed = history ? ['limit', 'beforeSequence', 'afterSequence'] : [];
  for (const key of params.keys())
    if (!allowed.includes(key) || params.getAll(key).length !== 1) invalid();
  if (params.has('beforeSequence') && params.has('afterSequence')) invalid();
  const limit = params.has('limit') ? integer(params.get('limit')) : 30;
  if (limit > 100) invalid();
  return {
    limit,
    ...(params.has('beforeSequence')
      ? { beforeSequence: integer(params.get('beforeSequence')) }
      : {}),
    ...(params.has('afterSequence')
      ? {
          afterSequence:
            params.get('afterSequence') === '0'
              ? 0
              : integer(params.get('afterSequence')),
        }
      : {}),
  };
}

@Catch(ChatMessageRequestError, ChatPolicyError, HttpException)
class ChatFilter implements ExceptionFilter {
  catch(
    error: ChatMessageRequestError | ChatPolicyError | HttpException,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof HttpException ? error.getStatus() : error.status;
    if (status === 503 || status === 429)
      response.setHeader('Retry-After', status === 503 ? '1' : '60');
    response
      .status(status)
      .json(
        error instanceof HttpException
          ? error.getResponse()
          : { statusCode: status, code: error.code, message: error.code },
      );
  }
}

@Injectable()
class ChatLimit implements CanActivate {
  constructor(private readonly rate: ChatRate) {}
  canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    if (process.env.CHAT_TEXT_ENABLED !== 'true')
      throw new HttpException({ code: 'CHAT_NOT_ENABLED' }, 404);
    if (
      req.method === 'GET' &&
      (req.headers['transfer-encoding'] ||
        Number(req.headers['content-length'] ?? 0) > 0)
    )
      invalid();
    const group =
      req.method === 'GET' || req.path.endsWith('/read')
        ? 'read'
        : req.path.endsWith('/messages')
          ? 'send'
          : 'open';
    this.rate.consume(req.user.userId, group);
    return true;
  }
}

@Controller('chat/conversations')
@ApiTags('chat-text')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ChatLimit)
@UseFilters(ChatFilter)
class ChatController {
  constructor(private readonly chat: ChatService) {}
  @Get()
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor opaque từ nextCursor; không dùng làm quyền truy cập.',
    schema: { type: 'string', maxLength: 160 },
  })
  inbox(@CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.chat.inbox(actor.userId, chatInboxPage(req.originalUrl));
  }
  @Post()
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['storeId'],
      properties: {
        storeId: { type: 'integer', minimum: 1, maximum: 2147483647 },
      },
    },
  })
  open(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    chatPage(req.originalUrl, false);
    return this.chat.open(actor.userId, bodyId(body, 'storeId'));
  }
  @Get(':id')
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    chatPage(req.originalUrl, false);
    return this.chat.detail(actor.userId, integer(id));
  }
  @Get(':id/messages')
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
  })
  @ApiQuery({
    name: 'beforeSequence',
    required: false,
    description: 'Không kết hợp afterSequence.',
    schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
  })
  @ApiQuery({
    name: 'afterSequence',
    required: false,
    description: '0 để tải bù từ đầu; không kết hợp beforeSequence.',
    schema: { type: 'integer', minimum: 0, maximum: 2147483647 },
  })
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.chat.history(
      actor.userId,
      integer(id),
      chatPage(req.originalUrl, true),
    );
  }
  @Post(':id/messages')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['clientMessageId', 'type', 'content'],
      properties: {
        clientMessageId: {
          type: 'string',
          pattern: '^[!-~]{1,128}$',
          maxLength: 128,
        },
        type: { type: 'string', enum: ['TEXT'] },
        content: {
          type: 'string',
          minLength: 1,
          maxLength: 2000,
          description:
            'Trim trước kiểm tra; giới hạn theo Unicode code points.',
        },
      },
    },
  })
  send(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    chatPage(req.originalUrl, false);
    return this.chat.send(actor.userId, integer(id), body);
  }
  @Post(':id/read')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['lastReadMessageId'],
      properties: {
        lastReadMessageId: { type: 'integer', minimum: 1, maximum: 2147483647 },
      },
    },
  })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    chatPage(req.originalUrl, false);
    return this.chat.read(
      actor.userId,
      integer(id),
      bodyId(body, 'lastReadMessageId'),
    );
  }
}

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    JwtModule.register({}),
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatLimit, ChatEvents, ChatRate, ChatGateway],
})
export class ChatModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((_req: Request, res: Response, next: () => void) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes(ChatController);
  }
}
