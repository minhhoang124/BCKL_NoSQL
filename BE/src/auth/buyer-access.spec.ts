import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BUYER_ACCESS_KEY, canActAsBuyer } from './buyer-access.js';
import { ROLES_KEY } from './decorators/roles.decorator.js';
import { RolesGuard } from './guards/roles.guard.js';
import { vi } from 'vitest';

describe('Explicit Buyer capability, not a global role hierarchy', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    [Role.USER, false, true],
    [Role.USER, true, true],
    [Role.SELLER, false, false],
    [Role.SELLER, true, true],
    [Role.ADMIN, false, false],
    [Role.ADMIN, true, false],
    ['buyer', true, false],
    [undefined, true, false],
  ])('role %s rollout %s => %s', (role, enabled, allowed) => {
    expect(canActAsBuyer(role, enabled as boolean)).toBe(allowed);
  });
  it.each(['false', '', '1', 'TRUE', undefined])(
    'requires literal true, not %s',
    (value) => {
      vi.stubEnv('ACCOUNT_BUYER_ACCESS_ENABLED', value);
      expect(canActAsBuyer(Role.SELLER)).toBe(false);
    },
  );
  function guard(allowed: Role[], actual: Role, marked: boolean) {
    class Controller {}
    const handler = () => undefined;
    Reflect.defineMetadata(ROLES_KEY, allowed, handler);
    if (marked) Reflect.defineMetadata(BUYER_ACCESS_KEY, true, handler);
    const context = {
      getHandler: () => handler,
      getClass: () => Controller,
      switchToHttp: () => ({ getRequest: () => ({ user: { role: actual } }) }),
    } as unknown as ExecutionContext;
    return new RolesGuard(new Reflector()).canActivate(context);
  }
  it('does not broaden an unmarked USER endpoint', () => {
    vi.stubEnv('ACCOUNT_BUYER_ACCESS_ENABLED', 'true');
    expect(guard([Role.USER], Role.SELLER, false)).toBe(false);
  });
  it('never broadens Seller or Admin endpoints', () => {
    vi.stubEnv('ACCOUNT_BUYER_ACCESS_ENABLED', 'true');
    expect(guard([Role.SELLER], Role.USER, true)).toBe(false);
    expect(guard([Role.ADMIN], Role.SELLER, true)).toBe(false);
    expect(guard([Role.USER], Role.ADMIN, true)).toBe(false);
  });
  it('allows explicitly marked Buyer requests only when enabled', () => {
    vi.stubEnv('ACCOUNT_BUYER_ACCESS_ENABLED', 'true');
    expect(guard([Role.USER], Role.SELLER, true)).toBe(true);
    vi.stubEnv('ACCOUNT_BUYER_ACCESS_ENABLED', 'false');
    expect(guard([Role.USER], Role.SELLER, true)).toBe(false);
  });
});
