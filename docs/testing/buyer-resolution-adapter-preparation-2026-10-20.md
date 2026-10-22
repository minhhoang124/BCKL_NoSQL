# Buyer resolver adapter — PREPARATION 20/10/2026

Nền develop `2f78a98`; contract thiết kế #69, dùng validator receipt Buyer #70
đã merge. Không ghép source/schema #74 hoặc journal #75 chưa merge.

## Luồng và biến để đọc code

`buyerResolutionApi.ts` chưa có caller ở router/UI. Không tự gửi khi mount.

1. `prepareBuyerResolution`: chụp identity vào handle bất biến. `actorId` là Buyer
   đã xác minh, `orderId` đơn gốc, `total` tiền snapshot đã biết từ Order; không
   lấy các kỳ vọng này từ response cần kiểm. `idempotencyKey` giữ key gốc,
   `requestHash/hashVersion` lấy pending metadata hợp lệ. Không sinh key mới.
2. `sendBuyerResolution`: POST một lần tới `/orders/:id/resolve-command`, exact
   body3fields, no-store, không tự refresh/replay khi401; timeout30giây và signal
   ngoài. Backend endpoint chưa có trên develop: module này chưa được nối UI.
3. `validateBuyerResolution`: exact envelope. COMMITTED dùng full Buyer receipt
   validator, replay=true, kiểm tiền/actor/time/timeline; tái tính hash từ reason
   canonical của receipt hoặc complete body{}. Không normalize Unicode mới.
   CLOSED kiểm identity/time/ID, không giả đây là hủy/hoàn tất đơn.
4. Chụp receipt/identity trước async hash; kiểm session sau HTTP và sau digest.
5. WeakMap proof chỉ thuộc invocation hiện tại; clone/GET/pure validation không
   có proof. Proof không là chữ ký hay bảo đảm chống XSS. Không được dùng nó thay
   CAS/check pending đầy đủ khi nối journal về sau.

Không lưu storage, không remove/ACK/settle journal, không giữ raw reason ngoài
RAM, không đổi API/backend/schema hoặc bật command buttons.

## Kiểm thử

- Frozen offline install PASS, không đổi lockfile.
- 29 adapter tests PASS: original key/body, hash chuẩn contract (complete và
  cancel OTHER), malformed200, reason tampering, actor/session/clone proofs,
  snapshot async, logout, timeout signal và401/409/429/500 không auto replay.
- Full FE691PASS/6liveSKIP,38filesPASS/1SKIP;65.83giây. Không cộng29lần nữa.
- Lint exit0,5warning Admin nền; TypeScript/Vite build PASS; diff-check PASS.
- Tests dùng HTTP giả lập/WebCrypto thật; KHÔNG proof Backend/PostgreSQL/browser.
  Timeout test chứng minh wiring finite signal, không đo socket/clock30s thật.

## Điểm nối còn thiếu

Sau #74/#75 merge: sync adapter với runtime/journal thật, review contract delta;
coordinator phải consent riêng, kiểm CAS pending và remove/readback an toàn.
Unknown/network/invalid response giữ pending; GET lỗi sau outcome đã biết chỉ
reload GET, không gửi execute lại. Chạy Browser→HTTP→PostgreSQL trước bật Buyer.
Không coi PREPARATION này là Buyer cancel/complete Web đã hoàn thành.
