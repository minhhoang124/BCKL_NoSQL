# Bàn giao ngữ cảnh Codex → Claude đồng leader

Ngày 31/10/2026, Asia/Saigon. Đây là tài liệu ngữ cảnh, không phải toàn bộ lịch sử chat hoặc chứng nhận nghiệm thu. Không chứa credentials. Chỉ đạo mới của owner được ưu tiên.

## Quyền và ownership đang có hiệu lực

- Owner giao **Codex và Claude đồng leader**, Claude giữ BE; Antigravity giữ FE và review tích hợp. Claude là coordinator hoạt động khi Codex bàn giao; Codex không còn source writer đang chạy. Chỉ một người ghi context/baseline/integrate Git tại một thời điểm.
- Root `C:/Vo Minh Hoang/BCKL_2026`; checkout duy nhất `release-integration`. Không sửa checkout `repo`, `release-hardening`, `source-code`. Có thể dùng interpreter cũ nhưng không sửa code ở checkout cũ.
- Branch `feat/hoang/sku-management-final`, HEAD cuối Codex kiểm `60f2091`. Có nhiều WIP BE của Claude và FE của Antigravity, chưa commit/push; git status và hashes phải kiểm lại lúc tiếp nhận. Baseline106file/source094d455 là trước đợt UX, không restore nó đè WIP.
- Model: mọi Claude/Argon tối đa Medium, Flash tối đa High. Không dangerously-skip-permissions. Owner muốn hành động nhưng cẩn thận, không hỏi lại quyền đã cấp.
- Hạn nộp08/11/2026; không mặc định là ngày bảo vệ. Bốn tiêu chí: ổn định, thực tế, dễ mở rộng, cẩn thận.
- Đọc AGENTS, agent-context README→CURRENT→DECISIONS→WORKBOARD→PROTOCOL, tài liệu miền trước sửa. Không sửa migration cũ; PG nguồn chính, ES/FAISS index phụ, giá/kho theo SKU, Order snapshot bất biến.
- Không commit secret/env/model/index/upload/dump/logprivate. Không reset Demo/seed đè dữ liệu. Không tự mail/provider/TOS/tunnel/Azure/cost. Azure Education có tài khoản nhưng chưa chốt tài nguyên/domain/chi phí.
- D15 cho push candidate đã review; D17 cho merge138/139 (đã xong), không phải quyền merge mọi PR sau. WIP UX hiện chưa được chốt: không stage/push toàn bộ lẫn file của agent khác trước review. Không đổi CI/billing hoặc bỏ checks vì quota. Khi cần tiếp tục Git, chỉ một integrator và scope rõ.

## Yêu cầu UX mới nhất — không thực hiện phương án đã bị thay thế

Nguồn đầy đủ: `C:/Vo Minh Hoang/BCKL_2026/DANH_SACH_PHAN_HOI_UX_2026-10-31.md` và `2026-10-31-UX-execution-brief.md` trong cùng thư mục handoffs.

1. Admin: mã đơn hiển thị khác ID nội bộ; cần danh sách/tìm đơn rõ ràng. Avatar hiện gắn logout theo phản hồi owner: mở menu/tài khoản thay vì logout, có hành động đăng xuất riêng. Màn giao/hoàn cần trực quan theo trạng thái, giữ consent/receipt/recovery.
2. Hồ sơ: bỏ role USER/ID nội bộ ở giao diện mua sắm; tách Hồ sơ/Địa chỉ/Bảo mật. Không xóa role khỏi kiểm quyền.
3. Đổi mật khẩu: email xác nhận trước mở form mật khẩu mới, purpose riêng, tokenhash/TTL/one-use/sessionbinding, GET scanner không tiêu thụ, server kiểm khi commit, revoke/CV/audit nguyên tử. Giữ current-password reauth hiện có, không tự bỏ; xử lý Google-only/unverified/crossdevice rõ. Chưa có quyền gửi thư thật mới.
4. **Luồng đã chốt theo web: Mua ngay → giỏ hàng → chọn sản phẩm/Mua hàng → checkout → Đặt hàng.** KHÔNG giao thêm API mua thẳng độc lập vì audit cũ. Hai nút PDP Thêm vào giỏ hàng/Mua ngay; bộ −/số/+ cảPDP/cart, giữ dòng giỏ khác, chống doubleclick, không tự đặt hàng.
5. Giỏ/checkout: ảnh/tên/phân loại/giá/số lượng/thành tiền theoStore; tổng đúng các dòng chọn. Khối địa chỉ người nhận/phone/địa chỉ, Thay đổi/Thêm mới tại chỗ, không mất draft. COD/VNPay theo readiness, nút Đặt hàng rõ.
6. Order: list cần previewbounded, detail/timeline dễ đọc. Giá/tên/phân loại lịch sử lấysnapshot. Ảnh đã quyết định dùng ảnhProducthiệntại có kiểmquyền/nullfallback, chưamigrationảnhsnapshot.
7. Chatmini: nổi xuyêntrang, thu nhỏ/mở rộng, mobile khôngcheCTA, dùngchungcore/socket, Store/name/preview/unread/read; tựread chỉ tin đãhiểnthị khi đangxem. Chuyểnaccountclearstate, khôngautoreplay tin chưa rõkếtquả; giữ cơchếrecovery nhưngbớt UIkỹthuật. Không thêmfile/video/bot từảnhShopee.
8. Notification: dropdownmới nhất/Xem tấtcả, unread, liênkếtđúngđơn, cậpnhậtxuyêntrang. BEđãcónguồnlịchsử; badgehiệnpoll30s/inboxchưatựrefreshliêntục. ProfileDemolưuworkerfalse nhưngGETinboxcóprojectbù. Khônggọiworkerfalse=BEkhôngcóthôngbáo; khôngbậtDemoautoworkerđểcheUX.
9. Địachỉ: hiệncótrim/required/length/ownership/default/max20 vàphone8–15digits nhưngkhôngxácminhchủsố. Tỉnh/phườngtexttựdo, postalchỉlength; cầnnguồndanhmụccóversion/validationBE+cặpselectFE, khôngbịađịagiới hoặcápngượcđịachỉOrdercũ. SMSthật/geolocationkhôngtựvàophạmvi.
10. Seller tạoSP: ảnh/SKU/giá/kho/attributes/kiệnhàngđãcóeditor nhưngẩnđếnkhichọnChỉnhsửa. Làmflowđủrộng/chialuồngrõ,lưunháp→bổsung→gửiduyệt, checklistthiếu+đếnđúngfield; listảnh/giá/kho/trạngtháitiếngViệt.
11. PDPmô tả/thôngsốphảihữuíchtheodữliệuthật, khôngbịathôngsố/bảohành. BannerNoelđượcownerchophéptrangtrí; BCTbadgeđãxóa; khôngcoivoucher/cashback/chínhhãnglànghiệpvụđãcó. ẢnhShopeelàthamkhảo, khôngsaochepPII/ngânhàng/bảohiểm/xu/ưuđãi.

## BE-UX-01 — trạng thái vừa xác minh

Claude đã triển khai order preview/detail ảnh và cart lineTotal. Handoff authoritative: `2026-10-31-BE-UX-contract.md`.

- List thêm `itemPreview` tối đa3dòng, `itemCount`, `totalQuantity`, `hasMoreItems`; querybatch/window khôngN+1, chỉIDs pageđãkiểmquyền.
- Ảnh theo endpointscope BUYER/SELLER, khôngrole: BuyerchỉProductACTIVE/APPROVED,StoreACTIVE,selleractive; SellerchủStoređượcảnhProductẩn. SELLERmuaqua/ordersvẫnlàBuyerpolicy.
- imageUrlgiữnguyênURLlưusauvalidation bằngnormalizeSearchImageUrl, khôngfetch. Ảnhhiệntạikhônglàsnapshot; tên/options/tiềnsnapshotkhôngđổi.
- **Contract mới: `itemPreview[].options: string[] | null`**; snapshotlegacyhỏngtrảnullchỉdòngpreviewđó, khônglàmGETlist500. FEfallbackXemchitiết/khônginrawJSON. Detailhỏngvẫngiữ500failclosedcũ, khôngbùtừcatalog.
- CartlineTotaltínhDecimal, làgiáhiệntại, kháctiềnOrder; dòngprivate/VARIANT_UNAVAILABLEkhônglộtrườngnày.
- Claude báo2037unit/93filesPASS, build/tscPASS,2lintwarningsSearchcũ. Codexđọc báo cáo nhưngchưarerun2037ởlượtbàngiaonày.
- **Codex trực tiếp đọc results/provenance:** QA1 `machine-local/final-day-20261030/be-ux01-qa-1793439585660/`:241PASS13FAIL0pending. Hiệnlệch4filesaufix:preview.ts/spec,list.dto,detail.e2e. Lỗiappthậttronglist500đãtìm/sửa; assertionảnhcũđượcđổikiểmđúngchínhsáchảnhhiệntại,khôngbỏsnapshotassertion.
- QA2 `.../be-ux01-qa-1793439827030/`:68PASS0FAIL0pending (detail,list,seller-buyer-access), provenancehashkhớphoàntoànsourceBEhiệntạikhiCodexkiểm. Khôngcộng241+68nhưmộtsuitecuối.
- 11FAILở4suitecancel/delivery/sellercommand/returnedlàfixtureCREATEFUNCTION/TRIGGERbị42501vìruntimeDML. **CònOPEN**,khôngskip/nhậnPASS/miễnnghiệmthu. ChưacótestDBgiảtrởthànhbằngchứngPostgreSQL.
- Cart31HTTPPASSthuộcQA1; sourcecartkhôngđổisaulượtđó, cógiáDecimal lớn/nullprivatedata. QuyềnSELLERscopeBuyerđãcóHTTPthậttrongsuitebuyeraccess, flagbậtpertestkhôngglobal.

## Việc Claude cần làm tiếp khi điều phối

1. Giữ BE-UX-01 ở trạng thái accepted theo từngAPI/phạmvi đãđạt; nhậncheckpointFEvàbáoAntigravityoptionsnullable. Không gọi toànBE xong.
2. Khép11ca faultinjection: tách setup/teardownDDL bằng kết nốiQAprovisioner/migrator cóguard đúngdatabaseQA dùngmộtlần; **request/runtimevẫnbckl_local_appDML**. KhôngcấpCREATEchoapphoặcmởDDLtrênDemo. Đọc các helperprovisionerQAđãcóvàguard; thiếuquyềnthìbáoowner, khôngnéguard.
3. Chạycart+4suiteregression trênsourcecuốisaukhépfixturesetup; giữlượtfailvànguyênnhân. Khôngrerunfullmọithứnếukhôngcósource/rủirođổi; nguồn/ma trậnphảichínhxác.
4. Launcher Codexđãcấp `C:/Vo Minh Hoang/BCKL_2026/machine-local/run-be-ux01-qa-20261031.mjs`:8suiteallowlist,DBmớimỗilần,loopback5549,40migrations,appruntimeDML,khôngproviders/workers. FingerprintchỉBEđểFEđangviếtkhônglàmnhiễu. TênDB `bckl_order_resolution_test_final_20261030_<13digit>` làguardcũcóhiệulực,khôngtựđổiregexvìhômnay31/10. `--prepare` chỉprovision DBkhác,khôngtest; khôngdùngnólàbằngchứngtestPASS.
5. QA2khôngchứngminhFE mớihoạtđộng; phảiđợiAntigravityhandoff/test/build/ảnh vàread-onlycrossreviewcontract/session/tiền/kho.
6. TiếptheoBE: lookupmãđơn,địagiới,đổimậtkhẩuemail,notificationoperational vàproposalđóngđơnVNPaygiao thấtbại. NhậnCODreturnedhiệnchỉCODUNPAID; khôngtựnhậnVNPayPAIDvàgọiđãrefundthật.
7. Giữcácphầnđãtest,khôngviếtlạichat/đơn/Seller/SKU. Chốtcheckpointnhỏ/handoffrồiđiềuphốiFE,chỉmộtwriter/file.

## Bằng chứng lịch sử và giới hạn

- Sourcebase60f2091đãpushtrướclượtUXnày;PR138/139đãsquashmergeddevelop63ebcd6/3be37d8.CandidatecònSKU/Auth/SellerClose/UI/lockfixmớihơndevelop. Đừngkêunhómchỉpulldeveloprồimongđủcandidate.
- TrướcUXmới:fullBE1987unitPASS;FE1865PASS6SKIP/buildPASS;ChromeQA12nhómcùngOrderCOD60k,kho3→1,1movement/6commands+3UXPASS,24ảnh tạiroot `BAO_CAO_CHOT_UX_2026-10-31/`. Đây làsource cũ,khôngnghiệmthuFEđangđổimới. ReportFAIL_UX54ảnhgốcgiữriêng.
- GiaoCOD:Sellerconfirm/packing/ready→Adminship/deliver→Buyercomplete;thấtbại,giao lại tổngtốiđa4lần,nhậnhànghoànmớirestocknếuđủđiềukiện;hỏng/thấtlạckhôngrestock.
- GoogleLINK/loginvàResendverify/resetđãcóownerthao táclocalQA; khônggánthànhbusinessmaildeliveryhoặcHTTPSaccepted. Link127.0.0.1chỉmởđượctrênmáychạydựán; từđiệnthoại/máykháckhôngtruycậpđượclocalhostmáyHoàng.
- VNPaySIT/NCB/IPNđãcóbằngchứngsandboxtrước,QC/HTTPSonlinecòngate. MoMoP2.Emailngườinhậnđượccấplưuriêng,khôngđưavàomemory/prompt. Khôngcầnnhắclạipassworddemotrongbàngiao.
- HaiCIpostmerge138/139FAIL/6jobs0steps,quotaownerđãbáo;khôngtestcodefailvàkhôngCIgreen.Khôngrerun/billing/workflowbypass.
- Docker/startallDemođãđượckhởiđộng,FE5173/API3001/AI8000từng200/40migration; **kiểmlạilive**,khônglấycheckpointcũthaytrạngtháihiệntại. Startup `machine-local/start-all.ps1 -Profile Demo` dùngmanagedhiddenprocess,khôngseed/migrateDemo tựđộngnếuguardkhôngkhớp.
- Môi trườngonlineBEchưachốt,FEcóVercelpreview;localtestkhôngproduction-ready,ASVScertificationhayheldoutevaluation.

## Báo cáo và tài liệu cần đọc

- `docs/agent-context/handoffs/2026-10-31-BE-UX-contract.md` (BEworker tự cập nhật).
- `docs/agent-context/handoffs/2026-10-31-FE-UX-handoff.md` (FEworker, nếu chưa có thì chưa cóhandoff).
- `2026-10-31-UX-execution-brief.md` (phạmvi/fileownership/testcriteria).
- Root `DANH_SACH_PHAN_HOI_UX_2026-10-31.md` (ownerfeedback/ảnhthamchiếu).
- Root `BAO_CAO_RASOAT_NGHIEP_VU_BE_2026-10-31.md` (audit, nhưngdirectpurchaseđềxuấtcũđãbịownerđổitheowebcart).
- `docs/testing/pr138-pr139-merged-2026-10-31.md`, `ux-close-2026-10-31.md`, `backend-final-acceptance-2026-10-30.md` chỉápdụngđúngsource/phạmviđãghi.

Đây là bản export có chọn lọc ngữ cảnh dự án hiện có, không gồm secret, lịch sử riêng ngoài dự án hoặc hướng dẫn hệ thống của công cụ. Import vào Claude Memory không tự đồng bộ file/runtime hay toàn bộ hội thoại; Claude phải đọc các file thật và kiểm lại source trước làm việc.
