import { Prisma } from '@prisma/client';
import { chatSqlState } from './chat-sql-state.js';
describe('Chat structured SQLSTATE', () => {
  it.each(['40001', '40P01', '55P03', '57014'])(
    'extracts adapter %s',
    (code) => {
      expect(
        chatSqlState(
          new Prisma.PrismaClientKnownRequestError('safe', {
            code: 'P2010',
            clientVersion: '7.10.0',
            meta: { driverAdapterError: { cause: { originalCode: code } } },
          }),
        ),
      ).toBe(code);
    },
  );
  it('does not interpret error messages as retry evidence', () =>
    expect(chatSqlState(new Error('40001'))).toBe(''));
});
