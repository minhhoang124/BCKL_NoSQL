-- References deliberately survive Product deletion; never snapshot private content.
ALTER TABLE chat_messages ADD COLUMN "contextProductId" INTEGER;
ALTER TABLE chat_messages ADD CONSTRAINT chat_product_context_check CHECK (
  "contextProductId" IS NULL OR
  ("contextProductId" > 0 AND content = 'Đã chia sẻ sản phẩm')
);
