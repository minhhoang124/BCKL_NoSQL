import { Prisma } from '@prisma/client';
// All values and routes are derived from allowlisted server state, never reason/content.
export const notificationSources: ReadonlyArray<{
  kind: string;
  query: Prisma.Sql;
}> = [
  {
    kind: 'ORDER',
    query: Prisma.sql`
 SELECT r.id AS "recipientId",r.audience,h.id::bigint AS "sourceId",h."createdAt" AS "eventAt",
 'Đơn hàng có cập nhật'::text AS title,
 'Đơn #'||o.id||': '||CASE h."toStatus"::text
 WHEN 'PENDING_CONFIRMATION' THEN 'chờ xác nhận' WHEN 'CONFIRMED' THEN 'đã xác nhận'
 WHEN 'PACKING' THEN 'đang chuẩn bị' WHEN 'READY_TO_SHIP' THEN 'sẵn sàng giao'
 WHEN 'SHIPPING' THEN 'đang vận chuyển' WHEN 'DELIVERED' THEN 'đã giao'
 WHEN 'COMPLETED' THEN 'đã hoàn tất' WHEN 'CANCELLED' THEN 'đã hủy'
 WHEN 'DELIVERY_FAILED' THEN 'giao chưa thành công' END AS text,
 CASE r.audience WHEN 'BUYER' THEN '/account/orders/' ELSE '/seller/orders/' END||o.id AS link
 FROM order_status_history h JOIN orders o ON o.id=h."orderId" JOIN stores s ON s.id=o."storeId"
 CROSS JOIN LATERAL (VALUES(o."buyerId",'BUYER'),(s."sellerId",'SELLER')) r(id,audience)
 WHERE h."actorId" IS DISTINCT FROM r.id AND h."toStatus"::text IN
 ('PENDING_CONFIRMATION','CONFIRMED','PACKING','READY_TO_SHIP','SHIPPING','DELIVERED','COMPLETED','CANCELLED','DELIVERY_FAILED')`,
  },
  {
    kind: 'STORE',
    query: Prisma.sql`
 SELECT s."sellerId" AS "recipientId",'ACCOUNT'::text AS audience,h.id::bigint AS "sourceId",h."createdAt" AS "eventAt",
 'Hồ sơ cửa hàng có cập nhật'::text AS title,
 'Store #'||s.id||': '||CASE h."toStatus"::text WHEN 'PENDING' THEN 'chờ duyệt' WHEN 'ACTIVE' THEN 'đã được duyệt' WHEN 'REJECTED' THEN 'cần bổ sung hồ sơ' WHEN 'SUSPENDED' THEN 'đang tạm khóa' WHEN 'CLOSED' THEN 'đã đóng' END AS text,
 CASE WHEN EXISTS(SELECT 1 FROM store_applications a WHERE a."storeId"=s.id) THEN '/account/store-application' ELSE '/seller' END AS link
 FROM store_status_history h JOIN stores s ON s.id=h."storeId"
 WHERE h."actorId" IS DISTINCT FROM s."sellerId" AND h."toStatus"::text IN ('PENDING','ACTIVE','REJECTED','SUSPENDED','CLOSED')
 UNION ALL
 SELECT a.id,'ADMIN',h.id::bigint,h."createdAt",'Có hồ sơ Store chờ duyệt','Store #'||s.id||' có hồ sơ được gửi duyệt. Mở lại để kiểm tra trạng thái hiện tại.',
 CASE WHEN EXISTS(SELECT 1 FROM store_applications p WHERE p."storeId"=s.id) THEN '/admin/store-applications?storeId='||s.id ELSE '/admin/stores' END
 FROM store_status_history h JOIN stores s ON s.id=h."storeId"
 JOIN users a ON a.role='ADMIN' AND a."isActive" AND a."createdAt"<=h."createdAt"
 WHERE h."toStatus"='PENDING' AND s.status='PENDING' AND h."actorId" IS DISTINCT FROM a.id`,
  },
  {
    kind: 'PRODUCT',
    query: Prisma.sql`
 SELECT s."sellerId" AS "recipientId",'SELLER'::text AS audience,h.id::bigint AS "sourceId",h."createdAt" AS "eventAt",
 'Kiểm duyệt sản phẩm có cập nhật'::text AS title,
 'Sản phẩm #'||p.id||': '||CASE h."toModerationStatus"::text WHEN 'PENDING' THEN 'chờ duyệt' WHEN 'APPROVED' THEN 'được duyệt' WHEN 'REJECTED' THEN 'cần chỉnh sửa' WHEN 'FROZEN' THEN 'bị tạm khóa' END AS text,
 '/seller'::text AS link
 FROM product_status_history h JOIN products p ON p.id=h."productId" JOIN stores s ON s.id=p."storeId"
 WHERE h."actorId" IS DISTINCT FROM s."sellerId" AND h."toModerationStatus"<>h."fromModerationStatus" AND h."toModerationStatus"::text IN('PENDING','APPROVED','REJECTED','FROZEN')
 UNION ALL
 SELECT a.id,'ADMIN',h.id::bigint,h."createdAt",'Có sản phẩm gửi duyệt','Sản phẩm #'||p.id||' được gửi duyệt. Mở lại để kiểm tra trạng thái hiện tại.','/admin/products'
 FROM product_status_history h JOIN products p ON p.id=h."productId"
 JOIN users a ON a.role='ADMIN' AND a."isActive" AND a."createdAt"<=h."createdAt"
 WHERE h."toModerationStatus"='PENDING' AND h."fromModerationStatus"<>'PENDING' AND p."moderationStatus"='PENDING' AND h."actorId" IS DISTINCT FROM a.id`,
  },
  {
    kind: 'AFTERSALE',
    query: Prisma.sql`
 SELECT r.id AS "recipientId",r.audience,h.id::bigint AS "sourceId",h."createdAt" AS "eventAt",
 'Yêu cầu hậu mãi có cập nhật'::text AS title,
 'Yêu cầu #'||a.id||': '||CASE h."toState" WHEN 'PENDING' THEN 'đang chờ xử lý' WHEN 'REJECTED' THEN 'đã bị từ chối' WHEN 'CANCELLED' THEN 'đã rút' WHEN 'DISPUTED' THEN 'cần Admin xem xét' WHEN 'AWAITING_RETURN' THEN 'chờ nhận hàng trả' WHEN 'REFUNDED' THEN 'đã hoàn tiền mô phỏng' WHEN 'ADMIN_REJECTED' THEN 'Admin đã từ chối' END AS text,
 CASE r.audience WHEN 'BUYER' THEN '/account/aftersales' ELSE '/seller/aftersales' END AS link
 FROM aftersale_history h JOIN aftersale_requests a ON a.id=h."requestId" JOIN order_items i ON i.id=a."orderItemId" JOIN orders o ON o.id=i."orderId" JOIN stores s ON s.id=i."storeId"
 CROSS JOIN LATERAL(VALUES(o."buyerId",'BUYER'),(s."sellerId",'SELLER')) r(id,audience)
 WHERE h."actorId" IS DISTINCT FROM r.id AND h."toState" IN('PENDING','REJECTED','CANCELLED','DISPUTED','AWAITING_RETURN','REFUNDED','ADMIN_REJECTED')
 UNION ALL
 SELECT u.id,'ADMIN',h.id::bigint,h."createdAt",'Hậu mãi cần Admin xem xét','Yêu cầu #'||a.id||' có bất đồng. Mở lại để kiểm tra trạng thái hiện tại.','/admin/returns'
 FROM aftersale_history h JOIN aftersale_requests a ON a.id=h."requestId"
 JOIN users u ON u.role='ADMIN' AND u."isActive" AND u."createdAt"<=h."createdAt"
 WHERE h."toState"='DISPUTED' AND a.state='DISPUTED' AND h."actorId" IS DISTINCT FROM u.id`,
  },
  {
    kind: 'CHAT',
    query: Prisma.sql`
 SELECT r.id AS "recipientId",r.audience,m.id::bigint AS "sourceId",m."createdAt" AS "eventAt",
 'Bạn có tin nhắn mới'::text AS title,'Mở hội thoại để đọc và kiểm tra quyền truy cập.'::text AS text,
 '/messages/'||c.id AS link
 FROM chat_messages m JOIN chat_conversations c ON c.id=m."conversationId" JOIN stores s ON s.id=c."storeId"
 CROSS JOIN LATERAL(VALUES(c."buyerId",'BUYER'),(s."sellerId",'SELLER')) r(id,audience)
 WHERE m."senderId"<>r.id`,
  },
  {
    kind: 'REVIEW',
    query: Prisma.sql`
 SELECT CASE WHEN h.action IN('create','edit') THEN s."sellerId" ELSE o."buyerId" END AS "recipientId",
 CASE WHEN h.action IN('create','edit') THEN 'SELLER' ELSE 'BUYER' END AS audience,
 h.id::bigint AS "sourceId",h."createdAt" AS "eventAt",'Đánh giá có cập nhật'::text AS title,
 'Mặt hàng #'||i.id||': '||CASE h.action WHEN 'create' THEN 'có đánh giá mới' WHEN 'edit' THEN 'đánh giá đã chỉnh sửa' WHEN 'reply' THEN 'cửa hàng đã phản hồi' WHEN 'hide' THEN 'đánh giá đã được ẩn' END AS text,
 CASE WHEN h.action IN('create','edit') THEN '/seller/reviews' ELSE '/account/reviews?itemId='||i.id END AS link
 FROM product_review_audits h JOIN product_reviews p ON p.id=h."reviewId" JOIN order_items i ON i.id=p."orderItemId" JOIN orders o ON o.id=i."orderId" JOIN stores s ON s.id=i."storeId"
 WHERE h.action IN('create','edit','reply','hide') AND h."actorId" IS DISTINCT FROM CASE WHEN h.action IN('create','edit') THEN s."sellerId" ELSE o."buyerId" END`,
  },
];
