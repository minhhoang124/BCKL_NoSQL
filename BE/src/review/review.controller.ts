import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { DatabaseModule } from '../database.module.js';
import {
  invalid,
  positive,
  validAction,
  type ReviewAction,
  type ReviewScope,
} from './review-input.js';
import { ReviewService } from './review.service.js';
type ActorRequest = Request & { user: AuthenticatedUser };
const id = (raw: string) =>
  /^[1-9][0-9]*$/.test(raw) ? positive(Number(raw)) : invalid();
@Controller()
export class PublicReviewController {
  constructor(private readonly reviews: ReviewService) {}
  @Get('products/:id/reviews') list(
    @Param('id') raw: string,
    @Req() req: Request,
  ) {
    return this.reviews.publicList(id(raw), req.originalUrl);
  }
}
@Controller()
@UseGuards(JwtAuthGuard)
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}
  @Get('account/order-items/:id/review') mine(
    @Req() req: ActorRequest,
    @Param('id') raw: string,
  ) {
    return this.reviews.mine(req.user, id(raw), req.originalUrl);
  }
  @Get('seller/reviews') sellerList(@Req() req: ActorRequest) {
    return this.reviews.list(req.user, 'SELLER', req.originalUrl);
  }
  @Get('admin/reviews') adminList(@Req() req: ActorRequest) {
    return this.reviews.list(req.user, 'ADMIN', req.originalUrl);
  }
  @Get('admin/reviews/:id') adminDetail(
    @Req() req: ActorRequest,
    @Param('id') raw: string,
  ) {
    return this.reviews.mine(req.user, id(raw), req.originalUrl, 'ADMIN');
  }
  @Post('account/order-items/:id/review/:action') @HttpCode(200) buyer(
    @Req() req: ActorRequest,
    @Param('id') raw: string,
    @Param('action') action: ReviewAction,
    @Body() body: unknown,
  ) {
    validAction('BUYER', action);
    return this.reviews.execute(req.user, 'BUYER', action, id(raw), body);
  }
  @Post('seller/reviews/:id/reply') @HttpCode(200) reply(
    @Req() req: ActorRequest,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    return this.reviews.execute(req.user, 'SELLER', 'reply', id(raw), body);
  }
  @Post('admin/reviews/:id/hide') @HttpCode(200) hide(
    @Req() req: ActorRequest,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    return this.reviews.execute(req.user, 'ADMIN', 'hide', id(raw), body);
  }
  @Post('review-commands/:scope/:action/:id/reconcile')
  @HttpCode(200)
  reconcile(
    @Req() req: ActorRequest,
    @Param('id') raw: string,
    @Param('scope') scope: ReviewScope,
    @Param('action') action: ReviewAction,
    @Body() body: unknown,
  ) {
    validAction(scope, action);
    return this.reviews.execute(req.user, scope, action, id(raw), body, true);
  }
}
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [PublicReviewController, ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
