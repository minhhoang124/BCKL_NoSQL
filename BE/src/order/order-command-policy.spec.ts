import { HttpException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import {
  nextOrderCommandStatus,
  type OrderCommandActor,
  type PreparedOrderCommandName,
} from './order-command-policy.js';

describe('Order new-command transition policy (not runtime authorization)', () => {
  const statusValues = Object.values(OrderStatus);
  const scenarios: {
    actor: OrderCommandActor;
    command: PreparedOrderCommandName;
    sources: OrderStatus[];
    target: OrderStatus;
  }[] = [
    {
      actor: 'SELLER',
      command: 'confirm',
      sources: ['PENDING_CONFIRMATION'],
      target: 'CONFIRMED',
    },
    {
      actor: 'SELLER',
      command: 'start-packing',
      sources: ['CONFIRMED'],
      target: 'PACKING',
    },
    {
      actor: 'SELLER',
      command: 'ready-to-ship',
      sources: ['PACKING'],
      target: 'READY_TO_SHIP',
    },
    {
      actor: 'BUYER',
      command: 'cancel',
      sources: ['PENDING_CONFIRMATION'],
      target: 'CANCELLED',
    },
    {
      actor: 'SELLER',
      command: 'cancel',
      sources: ['PENDING_CONFIRMATION', 'CONFIRMED'],
      target: 'CANCELLED',
    },
  ];
  for (const scenario of scenarios) {
    for (const status of statusValues) {
      it(`${scenario.actor} ${scenario.command} from ${status}`, () => {
        const run = () =>
          nextOrderCommandStatus(scenario.actor, scenario.command, status);
        if (scenario.sources.includes(status)) {
          expect(run()).toBe(scenario.target);
        } else {
          expect(run).toThrow(HttpException);
          try {
            run();
          } catch (error) {
            expect(error).toMatchObject({
              status: 409,
              response: {
                code:
                  scenario.command === 'cancel'
                    ? 'ORDER_CANNOT_CANCEL'
                    : 'INVALID_ORDER_TRANSITION',
              },
            });
          }
        }
      });
    }
  }
  it.each(['confirm', 'start-packing', 'ready-to-ship'] as const)(
    'rejects Buyer %s regardless of state',
    (command) => {
      for (const status of statusValues) {
        expect(() => nextOrderCommandStatus('BUYER', command, status)).toThrow(
          HttpException,
        );
      }
    },
  );
  it('does not mistake an already reached target for a replay', () => {
    expect(() =>
      nextOrderCommandStatus('SELLER', 'confirm', 'CONFIRMED'),
    ).toThrow(HttpException);
    expect(() =>
      nextOrderCommandStatus('BUYER', 'cancel', 'CANCELLED'),
    ).toThrow(HttpException);
  });
});
