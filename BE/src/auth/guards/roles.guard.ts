import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth.types.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { BUYER_ACCESS_KEY, canActAsBuyer } from '../buyer-access.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed?.length) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const buyerContext = this.reflector.getAllAndOverride<boolean>(
      BUYER_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );
    return Boolean(
      request.user &&
      (allowed.includes(request.user.role) ||
        (buyerContext === true &&
          allowed.includes('USER') &&
          canActAsBuyer(request.user.role))),
    );
  }
}
