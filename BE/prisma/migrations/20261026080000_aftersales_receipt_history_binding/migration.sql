-- Receipt history cannot be claimed by a second UUID. No existing receipt is
-- rewritten; corrupted or duplicated ledgers fail this upgrade closed.
ALTER TABLE aftersale_commands ADD CONSTRAINT aftersale_command_history_check CHECK (
 outcome='CLOSED' OR (
   receipt ? 'historyId' AND jsonb_typeof(receipt->'historyId')='string'
   AND (receipt->>'historyId') ~ '^[1-9][0-9]{0,18}$'
   AND (receipt->>'historyId')::numeric <= 9223372036854775807
 )
);
CREATE UNIQUE INDEX aftersale_command_history_unique
 ON aftersale_commands((receipt->>'historyId')) WHERE outcome='APPLIED';
