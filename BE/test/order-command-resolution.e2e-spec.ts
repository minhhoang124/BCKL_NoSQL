// Historical checklist from #63; these TODOs are NOT executable acceptance proof.
// Runtime/schema now exist in order-command-resolution-runtime.e2e-spec.ts and
// order-resolution-migration.e2e-spec.ts. See the evidence report's Rxx mapping;
// partial coverage must not be converted into fake PASS or silently removed.
describe('Historical resolver acceptance checklist — see runtime evidence mapping', () => {
  it.todo('R01 committed receipt remains canonical after Order advances');
  it.todo('R02 closing an unexecuted key is durable and idempotent');
  it.todo('R03 command-first DB barrier yields COMMITTED without fence');
  it.todo('R04 resolver-first DB barrier blocks late execution');
  it.todo('R05 key reused for another Order/command/hash conflicts');
  it.todo('R06 concurrent resolvers and app restart retain one outcome');
  it.todo(
    'R07 proxy loses post-commit response; explicit replay keeps identity',
  );
  it.todo('R08 injected failure before commit rolls back fence and response');
  it.todo(
    'R09 every USER-scope writer rejects a closed key across role changes',
  );
  it.todo('R10 direct insert bypassing application helper is blocked by DB');
  it.todo(
    'R11 two-connection stale-snapshot write skew cannot commit both outcomes',
  );
  it.todo(
    'R12 immutable/malformed resolution rows are rejected by constraints',
  );
  it.todo(
    'R13 fresh and upgrade migrations preserve existing business history',
  );
  it.todo(
    'R14 ownership/account checks precede receipt resolution, including state changes',
  );
  it.todo(
    'R15 malformed JSON/query/key/ID/content-type/body size yields safe error',
  );
  it.todo('R16 resolve and execution share one ingress quota');
  it.todo(
    'R17 DB timeout and retry exhaustion remain bounded and preserve pending',
  );
  it.todo(
    'R18 corrupt receipt/hash version or impossible dual outcome fails closed',
  );
  it.todo(
    'R24 closed original key stays blocked after a fresh intent succeeds',
  );
  it.todo(
    'R25 PROCESSING claim identity is immutable before completion, including key/scope/actor/order/command/hash and null-safe changes',
  );
});
