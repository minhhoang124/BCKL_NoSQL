-- Additive reference, never a private Order snapshot or cascading history FK.
ALTER TABLE "chat_messages" ADD COLUMN "contextOrderId" INTEGER;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_message_order_context_check"
  CHECK ("contextOrderId" IS NULL OR
    ("contextOrderId" > 0 AND "contextProductId" IS NULL
     AND "content" = 'Đã chia sẻ đơn hàng'));
