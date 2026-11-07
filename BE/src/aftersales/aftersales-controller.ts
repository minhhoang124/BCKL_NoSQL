import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
  HttpCode,
  MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PassportModule } from '@nestjs/passport';
import type { Request, Response, NextFunction } from 'express';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { SearchModule } from '../search/search.module.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AftersalesService } from './aftersales-service.js';
import type { Action, Scope } from './aftersales-input.js';
type ActorRequest = Request & { user: AuthenticatedUser };
const roots = ['aftersales', 'seller/aftersales', 'admin/aftersales'];
const routes = (tail = '') => roots.map((root) => root + tail);
const scope = (request: Request): Scope =>
  request.path.toLowerCase().startsWith('/admin/')
    ? 'ADMIN'
    : request.path.toLowerCase().startsWith('/seller/')
      ? 'SELLER'
      : 'BUYER';

@ApiTags('aftersales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AftersalesController {
  constructor(private readonly service: AftersalesService) {}
  @Get(routes())
  list(@Req() req: ActorRequest) {
    return this.service.list(req.user, scope(req), req.originalUrl);
  }
  @Get(routes('/requests/:id'))
  detail(@Req() req: ActorRequest, @Param('id', ParseIntPipe) id: number) {
    return this.service.detail(req.user, scope(req), id, req.originalUrl);
  }
  @Post('aftersales/items/:id/requests')
  @HttpCode(200)
  create(
    @Req() req: ActorRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.service.execute(req.user, 'BUYER', 'create', id, body);
  }
  @Post(routes('/requests/:id/:action'))
  @HttpCode(200)
  change(
    @Req() req: ActorRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('action') action: Action,
    @Body() body: unknown,
  ) {
    if (action === 'create')
      throw new BadRequestException({ code: 'AFTERSALE_INVALID_INPUT' });
    return this.service.execute(req.user, scope(req), action, id, body);
  }
  @Post(routes('/commands/:action/:id/reconcile'))
  @HttpCode(200)
  reconcile(
    @Req() req: ActorRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('action') action: Action,
    @Body() body: unknown,
  ) {
    return this.service.execute(req.user, scope(req), action, id, body, true);
  }
}

function boundary(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  const query = new URL(req.originalUrl, 'http://localhost').search;
  if (
    (req.method !== 'GET' && req.method !== 'HEAD' && query) ||
    (['GET', 'HEAD'].includes(req.method) &&
      (req.headers['transfer-encoding'] !== undefined ||
        (req.headers['content-length'] !== undefined &&
          req.headers['content-length'] !== '0')))
  ) {
    next(new BadRequestException({ code: 'AFTERSALE_INVALID_INPUT' }));
    return;
  }
  next();
}
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    SearchModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [AftersalesController],
  providers: [AftersalesService],
})
export class AftersalesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(boundary).forRoutes(AftersalesController);
  }
}
