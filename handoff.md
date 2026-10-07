# Handoff — Shopee Returns / ShopeeReturnManager

> Bàn giao cho agent Antigravity (Anti), cập nhật ngày **02/10/2026**, múi giờ Asia/Bangkok (UTC+7).
> Workspace chính: **`D:\Codex\ShopeeReturnManager`**.
> Đọc phần 1–4 trước khi thao tác. Tài liệu này không chứa token, mật khẩu hoặc cookie.

## 1. Tiếp quản nhanh

### Việc cần tiếp tục

1. **Xử lý việc người dùng không đăng nhập được ChatGPT trong Chrome riêng của tool.** Đây là blocker hiện tại; chưa sửa xong.
2. Khi đăng nhập được, kiểm chứng thật luồng: ảnh mẫu + prompt 1 → chờ đúng kết quả → lưu `1.png` và hiện preview → prompt 2 → … → prompt 5.
3. Ảnh lưu đúng `G:\My Drive\Hình ảnh Shopee\Sản phẩm thay thế\<shop>\<tên sản phẩm mới>\1.png…5.png`.
4. Khi đủ 5 ảnh, nhân viên bấm gắn vào đúng bài Notion; bước thay nội dung/ảnh/giá trên Shopee là thao tác riêng sau đó.
5. Giữ nguyên hoạt động của module hoàn/huỷ, module sản phẩm và dữ liệu hiện có.

### Quyết định mới nhất của người dùng

- **Giữ Chrome riêng**, không dùng chung Chrome hiện tại đang làm việc của người dùng để tạo ảnh.
- Cùng tài khoản ChatGPT và cùng cách nhập email/mật khẩu **đăng nhập mới được trong Chrome thường**, theo xác nhận của người dùng ngày 02/10/2026. Không phải chỉ còn phiên đăng nhập cũ.
- Người dùng nói không dùng VPN/đổi IP.
- Chưa xác nhận đăng nhập thành công trong profile Chrome thường mới tên “Shopee AI”. Ở lần kiểm tra gần nhất, Chrome vẫn dùng profile Debug của tool.
- Yêu cầu ở lượt bàn giao này là viết tài liệu; **không phải yêu cầu commit/push, tạo release hoặc thay đổi dữ liệu thật**.

### Không được coi là đã hoàn thành

- Bản 1.6.10 đã build/cài, tests local đạt theo bằng chứng bên dưới; **chưa có một bộ 5 ảnh ChatGPT thật chạy thành công end-to-end được xác minh**.
- Không lấy mock/fixture, ảnh preview, test tải ảnh hoặc build thành công làm bằng chứng tài khoản thật đã tạo ảnh.
- Không khẳng định “Cloudflare do Debug” hay “sai mật khẩu”: chưa có bằng chứng xác định nguyên nhân cuối cùng.
- Không xoá journal, cookie, profile hoặc cờ `submitted`/`uncertain` để làm cho nút chạy lại hoạt động.

## 2. Workspace, Git, phiên bản và bản cài

| Mục | Giá trị đã kiểm tra khi viết handoff |
|---|---|
| Source chính | `D:\Codex\ShopeeReturnManager` |
| Repository | `https://github.com/datdtpl-maker/Shopee-Returns` |
| Branch local | `main` |
| HEAD local | `107bb1c` — `Fix live Shopee product edits and add interface monitoring v1.4.1` |
| Phiên bản source | `1.6.10` trong `package.json` |
| Node / npm trên máy | `v24.13.0` / `11.6.2` |
| Electron | `44.3.0` |
| Dependencies | Playwright `^1.55.0`, Sharp `^0.35.5` |
| Build | electron-builder `26.15.3`, NSIS Windows x64 |
| App cài đặt | `C:\Users\datdt\AppData\Local\Programs\Shopee Returns\Shopee Returns.exe` |
| Phiên bản exe cài đặt | FileVersion `1.6.10`, ProductVersion `1.6.10.0` |
| Installer | `D:\Codex\ShopeeReturnManager\dist\Shopee-Returns-Setup-1.6.10-x64.exe` |
| Kích thước installer | `120507572` bytes |
| SHA-256 installer | `0da21c7301f490c23c6ecad5d76cf2de075cc799aa4668a1af15a3d60b734a3a` |
| Chữ ký | Bằng chứng release ghi `NotSigned`; cấu hình `signExecutable:false` |
| Backup trước cài 1.6.10 | `D:\Codex\Backups\ShopeeReturns-1.6.10-20261002-083746` |

**Working tree có rất nhiều thay đổi chưa commit**, bao gồm toàn bộ Studio/ChatGPT mới. Đã kiểm tra `git status`, không fetch remote trong lượt bàn giao; không suy ra GitHub đang chứa toàn bộ bản 1.6.10 từ version local.

Các file tracked đã thay đổi trước handoff: `README.md`, `package.json`, `package-lock.json`, `src/index.html`, `src/interface-ui.js`, `src/main.cjs`, `src/preload.cjs`, `src/products.cjs`, `src/renderer.js`.

Các nhóm untracked trước handoff: `src/chatgpt/`, `src/chrome-image-extension/`, `src/prompts/`, các file `src/replacement-*`, `src/replacements.cjs`, các file `src/studio-*`, cùng tests tương ứng. Không coi untracked là file tạm để xoá.

- **Tiếp tục từ working tree hiện tại**, không checkout/reclone rồi ghi đè.
- Không reset, clean, revert, commit/push/tag khi chưa có yêu cầu mới.
- `data/`, `work/`, `dist/`, `node_modules/`, `.env*`, `*.log` được ignore. Evidence trong `work/` không đi theo Git clone.
- Root hiện không có `.codegraph/`; không tự index. `D:\Codex\AGENTS.md` có quy tắc CodeGraph chỉ áp dụng khi index tồn tại.
- Cwd của agent có thể vẫn là `C:\Users\datdt\OneDrive\Tài liệu\App`; luôn đặt working directory đúng dự án.

## 3. Blocker đăng nhập ChatGPT — bằng chứng và giới hạn

### Biểu hiện

Trước đó profile riêng kẹt vòng “Performing security verification / Verify you are human”. Ảnh mới nhất cho thấy:

```text
URL: https://auth.openai.com/log-in/password
Title: Oops, an error occurred! - OpenAI
Route Error (400 ...): Invalid content type: text/html; charset=UTF-8
```

Đã kiểm tra trực tiếp tab này qua kết nối read-only tới CDP của profile do app quản lý: có lỗi `Invalid content type`, không có password form và không có composer ChatGPT ở thời điểm kiểm tra.

### Chẩn đoán mạng đã ghi

File: `work/chatgpt-login-diagnostic.json`.

- Thời gian: 09:32:30–09:35:31 ngày 02/10/2026, UTC+7; JSON lưu timestamp UTC.
- Theo dõi chỉ ghi host/path, method, loại request, status, content type, cờ challenge và trạng thái trang.
- Không ghi query string, request/response body, tài khoản, mật khẩu, cookie hoặc header xác thực.
- Ghi nhận một request `POST https://auth.openai.com/awe/api/v2/rum` trả `403`, `content-type: text/html; charset=UTF-8`, header `cf-mitigated: challenge`.
- **Đây là endpoint telemetry của trang, không phải request đăng nhập.** Không kết luận từ nó rằng POST mật khẩu trả cùng lỗi.
- Trong cửa sổ theo dõi chưa thu được lần submit đăng nhập mới. Công cụ theo dõi đã kết thúc; không có monitor tiếp tục chạy nền.
- Câu hỏi cuối trước bàn giao: nhờ người dùng bấm **Try again**, thử một lần và báo kết quả. Chưa có câu trả lời mới; người dùng chuyển sang yêu cầu handoff.

### Profile và cấu hình

- Profile đang dùng: `%APPDATA%\ShopeeReturns\data\chatgpt-studio\profile-cdp`.
- Chrome dùng `--remote-debugging-port=0`, loopback `127.0.0.1`; cổng thật đọc từ `DevToolsActivePort`, thay đổi theo lần mở.
- Lần chẩn đoán trước ghi nhận Chrome `154.0.8037.92`; kiểm tra lại nếu cần, không coi là bất biến.
- Đã đọc chọn lọc các thiết lập cookie/JavaScript/proxy của profile ở lượt trước, không thấy cấu hình chặn rõ ràng. Không có chứng cứ đủ để quy nguyên nhân cho các thiết lập này.
- Chrome thường đã được nhận diện với profile tên “Thành Đạt”. Lần kiểm tra trước handoff không thấy profile “Shopee AI” mới trong danh mục Chrome thông thường. Không tự coi nó đã tồn tại hoặc đã đăng nhập.
- Không chuyển/copy cookie, Login Data, auth DB giữa profile để “sửa” đăng nhập.

### Hành động từng bị chặn

Ở lượt trước, agent thử mở chính profile riêng hiện có bằng Chrome thông thường **không bật Debug** để người dùng đăng nhập thủ công. Bộ duyệt tự động từ chối hai lần với `rejected: blocked by policy`, không có lý do chi tiết. Đã báo cho người dùng.

Không lặp lại bằng shell/tool/wrapper khác nhằm né từ chối, không thêm stealth flags hoặc cơ chế tự vượt CAPTCHA. Chẩn đoán đăng nhập thông thường và quan sát response có thể tiếp tục trong phạm vi được công cụ hiện tại cho phép; bước xác minh/tài khoản do người dùng hoàn tất.

### Việc Anti nên làm tiếp

1. Đọc tình trạng hiện tại trước: người dùng có thử lại hay tạo profile riêng mới chưa; không hỏi lại lựa chọn dùng chung Chrome vì họ đã từ chối.
2. Nếu tái hiện lỗi, thu metadata của **request gây lỗi thật**, tối thiểu và đã che nhạy cảm. Không dump HAR/cookie/password toàn bộ.
3. Phân biệt lỗi auth/challenge của nhà cung cấp với lỗi nhận diện “ready” của app. App chưa gửi prompt khi chưa ready.
4. Chỉ sửa code khi có nguyên nhân/điểm lỗi tái hiện được; không hứa đổi cổng/profile sẽ hết Cloudflare.
5. Sau khi đăng nhập thành công, kiểm tra DOM composer/upload thật rồi chạy một bộ ảnh do người dùng chọn. Không tự tạo bộ thử khác hoặc gửi lại lượt cũ.

Một điểm cần kiểm tra **chỉ sau khi đăng nhập đã thành công**: `bindChatGptSession()` hiện dùng `.count()` cho iframe Cloudflare, kể cả iframe ẩn. Nếu có false negative ready, đây là vị trí cần kiểm tra visibility. Nó chưa được chứng minh là nguyên nhân lỗi đăng nhập hiện tại.

## 4. Dữ liệu hiện tại — phải giữ nguyên

Snapshot chọn lọc từ **bản cài đặt** lúc viết tài liệu, không phải kiểm tra session Shopee/Notion live:

| Cấu hình | Giá trị |
|---|---|
| `intervalMinutes` | `10` |
| `autoScan` | **`false`** |
| `notionEnabled` | `true` |
| `telegramEnabled` | `false` |
| `startWithWindows` | `true` |
| `keepAwake` | `true` |
| `closeToTray` | `true` |
| `notionAwaitScan` | `false` |

**Không tự bật lịch**. Có chu kỳ 10 phút không có nghĩa lịch đang chạy nếu `autoScan:false`. Không lấy cấu hình máy này để khẳng định cấu hình máy khác của người dùng.

| Profile local | UUID | Trạng thái lưu |
|---|---|---|
| `khaihoanpharmacy` | `61b9c533-c912-45fd-a507-1fc4eef329f8` | enabled, Sẵn sàng |
| `nhathuockh.pharma` | `6bd78a06-0b5e-4274-8123-2c19ee08ba17` | enabled, Sẵn sàng |

`products.json` có **266 dòng** của hai shop; dòng có thể tương ứng phân loại, không đồng nghĩa 266 product ID duy nhất. “Sẵn sàng” là giá trị đã lưu, chưa xác minh session còn hiệu lực ở lần bàn giao.

Studio có 2 job chưa xoá:

| Job ID | Shop | Product ID | Trạng thái |
|---|---|---|---|
| `2b37b4a6-a8e0-4118-8675-32cbbb145c36` | `nhathuockh.pharma` | `46903797152` | `published`, có notionUrl, chưa imagesReady, chưa chromeImageAttempted |
| `fb1d18d1-984c-4abe-b23a-74c495a32fe6` | `khaihoanpharmacy` | `50603772518` | `published`, có notionUrl, chưa imagesReady, chưa chromeImageAttempted |

Database Studio lưu local: `3ec70655-a9aa-8170-99c5-d877cdb5daa9`. Chưa gọi Notion để xác minh lại các trang trong lượt bàn giao.

Không xoá hai job này, không đổi `published` về draft, không dựng bài khác để thay thế lịch sử. Nếu live state đã đổi sau tài liệu, đọc lại trước khi thao tác.

## 5. Phạm vi sản phẩm và yêu cầu nghiệp vụ đã chốt

Ứng dụng Windows có ba nhóm chức năng: hoàn/huỷ; quản lý sản phẩm; Studio sản phẩm thay thế. Đây là app vận hành Electron, không phải web landing page và không có server giao diện công khai.

### 5.1. Module hoàn/huỷ

1. Mỗi tài khoản Shopee có profile riêng, đăng nhập thủ công và lưu local. Có sửa tên profile, giữ UUID và các tên cũ để chống nhầm dữ liệu.
2. Mở `https://banhang.shopee.vn/portal/sale/returnrefundcancel`.
3. Cuộn và đọc **toàn bộ một trang hiện tại**, không bấm sang các trang khác. Thu mã đơn, text đỏ/xanh trong cột **Vận chuyển chiều giao hàng**, trạng thái đơn.
4. Đọc mới Google Sheet, đối chiếu mã đơn chính xác; chỉ hiển thị/gửi khi có đúng một mã vận đơn hợp lệ, không xung đột.
5. Mặc định chu kỳ 10 phút, người dùng chỉnh 1–1440 phút; chỉ quét tự động khi bật lịch và app đang chạy.
6. Dữ liệu app có bộ lọc và nút gom nhóm theo text trạng thái vận chuyển.
7. **Chỉ đẩy dữ liệu thô lên Notion, không quản lý xử lý đơn**. Đã bỏ cột thao tác báo shipper/đã nhận hàng ở UI. Tool của dev khác xử lý tiến độ trên Notion.
8. Bản ghi mới luôn `Xử lý = Chưa xử lý`.
9. Nếu Notion đã có **Profile (kể cả tên cũ) + Mã đơn hàng**, bỏ qua hoàn toàn; không PATCH thời gian quét, trạng thái, ghi chú hay dữ liệu đã có. Vì vậy không thấy giờ mới trên Notion chưa chắc lịch hỏng.
10. Không cần các cột cũ “Mã theo dõi”, “Sheet nguồn”, “Đối chiếu Sheet”. Không tự xoá cột bổ sung do người khác quản lý.

Quy tắc đối chiếu quan trọng:

- Dùng toàn bộ mã đơn, normalize NFC + trim, không fuzzy match, không đổi hoa/thường.
- Sheet có mã vận đơn vì quy trình người dùng đã đóng/gửi đơn; không suy ra hãng vận chuyển đã nhận kiện chỉ từ mã.
- Thiếu mã, nhiều vận đơn, cùng vận đơn dùng cho nhiều đơn hoặc dòng trùng có dữ liệu mâu thuẫn: không hiển thị và không gửi.
- Lỗi một nguồn hoặc dữ liệu quá chu kỳ: không dùng cache cũ để giả lập dữ liệu mới.
- Evidence quét/đối chiếu giữ trong memory của tiến trình; dữ liệu lưu đĩa dùng audit/dedup, không đủ điều kiện gửi khi mở app lại.
- Đọc Shopee và Sheet lần lượt, không phải giao dịch đồng thời hoặc realtime từng giây.
- Mở app bình thường có lượt quét khởi động nếu có profile enabled và không bị chặn bởi trạng thái xoá Notion, kể cả khi lịch định kỳ đang tắt. `SRM_DRIVER=1` tắt hành vi khởi động này trong test.

Xoá dữ liệu Notion:

- Nút chỉ áp dụng bảng hoàn/huỷ; không xoá kho sản phẩm hoặc bài Studio.
- Có xác nhận, backup `notion-backups`, archive các hàng; không xoá database/schema/profile/Sheet.
- Xoá dang dở giữ cờ qua restart, chặn gửi/quét liên quan đến khi xử lý xong.
- Sau khi bảng trống, chờ quét mới để lấy dữ liệu đang đủ điều kiện rồi mới tiếp tục lịch.
- Không gọi thao tác này khi chẩn đoán ChatGPT.

Telegram là tích hợp tùy chọn, hiện tắt. Dedup theo profile + mã đơn, chỉ đánh dấu gửi sau thành công; timeout sau khi server nhận vẫn có rủi ro tin trùng do API sendMessage không có idempotency key.

### 5.2. Module sản phẩm, giá và tồn kho

Trang: `https://banhang.shopee.vn/portal/product/list/live/all?operationSortBy=recommend_v2`.

- Chọn đúng shop, đổi số dòng mặc định **12 → 48**, đợi reload, cuộn hết và đi **tất cả trang sản phẩm**. Không nhầm với module hoàn/huỷ chỉ đọc một trang.
- Đọc tên, giá, tồn kho, product ID, model ID và phân loại. Validate shop, completeness, ID trùng trước khi nhận lượt quét.
- Đơn vị dòng Notion: shop + product ID + model ID. Tên profile chỉ là nhãn local; tên tài khoản shop là identity dữ liệu sản phẩm.
- Bảng sản phẩm là **upsert**: thêm khi chưa có, cập nhật giá/kho/tên theo logic hiện có khi thay đổi; không tạo dòng trùng. Khác với bảng hoàn/huỷ chỉ insert.
- Dòng không đổi không ghi lại `Quét lúc`. Sửa trực tiếp Notion không tự thay Shopee.
- Có sửa từng dòng và sửa hàng loạt; giá/kho nhập là **giá trị tuyệt đối**, không phải tăng/giảm. Ô trống giữ nguyên, kho 0 hợp lệ.
- Mỗi lần sửa đọc mới Shopee, khóa đúng shop/ID/model/tên, đối chiếu hộp nhập rồi lưu và đọc lại xác minh.
- Không dùng số cũ từ Notion làm điều kiện bắt quét toàn shop lại. Giá khuyến mãi/giá gốc hoặc nhiều kho mơ hồ phải dừng.
- Batch tối đa 1.000 thay đổi; giá và kho là hai thao tác, có dừng sau mục hiện tại. Giữ draft lỗi/chưa chạy, không chạy lại tự động sau restart.
- Nếu Shopee đã lưu và xác minh nhưng Notion lỗi: chỉ retry sync Notion. Nếu chưa biết Shopee có lưu hay chưa: `uncertain`, đọc lại trước, không gửi lại lệnh.
- Module này chạy khi nhân viên bấm, không có lịch sản phẩm tự động riêng.

### 5.3. Theo dõi giao diện Shopee

- `InterfaceMonitor` đọc DOM/CSS thật của các thành phần hai module sử dụng; không phải trình biên dịch HTML/CSS và chưa tích hợp vision.
- Đỏ `INTERFACE_CHANGED`: cấu trúc/style không phù hợp; dừng luồng liên quan.
- Vàng `unavailable`: đăng nhập, mạng hoặc đang tải; không ghi nhận như thay đổi giao diện và không xoá cảnh báo đỏ trước đó.
- Xanh chỉ xác nhận phạm vi đã kiểm tra, không bảo đảm toàn website.
- Không đưa giá/tồn/tên/mã đơn/số dòng động vào fingerprint.
- Có probe danh sách hoàn/huỷ, danh sách sản phẩm, page size, dialog giá/kho. Dialog chỉ được kiểm tra khi thực sự mở.
- Baseline và reports lưu local; ảnh báo cáo che ô nhập theo khả năng, không gửi lên AI.
- Chỉ accept mẫu style sau khi xem kết quả mới trong 5 phút; thiếu cấu trúc hoặc sai semantic màu không được chấp nhận để lách kiểm tra.
- `ProductScanner.open()` chờ control tải muộn; không probe quá sớm rồi kết luận Shopee đổi UI.

## 6. Studio sản phẩm thay thế — workflow cuối cùng

### Các yêu cầu cũ đã được thay thế

- **Mỗi bài Shopee hiện có đã là một insight**. Không thêm ô số lượng insight/tên insight để nhân bản bài nữa.
- Một bài theo **shop + product ID**. Chọn lại nguồn mở bài hiện có; giữ nháp lịch sử, không tự merge/xoá.
- AI viết dựa vào **prompt + tên sản phẩm mới + giá + bố cục tham khảo** qua API Gemini, không mở profile Shopee chỉ để viết bài.
- Nhân viên xem/sửa rồi **Đẩy bài lên Notion**; không có bước UI “Duyệt bài” bắt buộc riêng. `approve()`/`approved` còn trong backend để tương thích và thể hiện xác nhận khi publish.
- Cấu hình Studio trên cùng. Nhập ảnh thủ công là mục dự phòng. Controls extension cũ được ẩn khi luồng chính chuyển CDP.
- Nút **Gắn 5 ảnh vào bài Notion** chỉ hiện khi đủ ảnh; không tự attach sau tạo ảnh và không tự chạy cập nhật Shopee.

### Bước 1 — viết và lưu bài

1. Tải/quét dữ liệu nguồn, chọn shop và sản phẩm theo ID; nguồn phải thuộc đúng profile đã liên kết.
2. Nhập tên mới, giá, prompt. Thư viện prompt mẫu có thêm/sửa/xoá; bài mẫu Oximin dùng tham khảo bố cục, không sao chép thành phần/công dụng sang sản phẩm khác.
3. Gemini trả JSON `name`, `description`; nội dung hiển thị ngay để nhân viên sửa.
4. Bấm publish tạo/đối chiếu bài trong bảng **Sản phẩm thay thế** trên Notion, chưa có ảnh.
5. Đối chiếu Mã tác vụ + shop + product ID để tránh tạo bài trùng. Nếu lần publish trước chưa xác minh, không tạo bài thứ hai.

Gemini:

- Key lưu mã hoá trong `credentials.enc`; không đọc/in key trong handoff hoặc debug log.
- Key là opaque token: không ép tiền tố `AIza`; hỗ trợ token có dấu chấm, trim ngoài, validate an toàn header/độ dài.
- API: `generativelanguage.googleapis.com/v1beta`, header `x-goog-api-key`.
- Model lấy từ API thực tế có `generateContent`; người dùng từng yêu cầu `gemini-3.8-flash`, nhưng không được khẳng định model đó tồn tại/có quyền nếu API không trả.
- `test()` hiện gọi cả danh sách model và thử đúng định dạng JSON viết bài; test thành công không bảo đảm request kế tiếp không bị quota/quá tải.
- Timeout toàn request 60 giây; retry tối đa 2 lần thêm cho HTTP 500/502/503/504. Phân biệt 401/403, 429, 503, key invalid, JSON sai/cắt.
- Giới hạn Studio: prompt 16.000 ký tự; tên 120; mô tả 5.000; giá nguyên 1–1.000.000.000.
- Prompt hệ thống không cho tự bịa thành phần, claim điều trị, liều dùng/chứng nhận; dữ kiện cần từ nhân viên. Không sửa công dụng sản phẩm chỉ để “né” kiểm duyệt.

### Bước 2 — 5 prompt, ảnh mẫu và ảnh kết quả

Luồng chính 1.6.10: **Chrome riêng + CDP**, không cần extension/mã ghép ở UI chính.

1. Mở Chrome riêng, đăng nhập thủ công, kiểm tra đăng nhập.
2. Chọn bài đã publish, chuẩn bị 5 prompt từ nội dung bài hiện hành, chọn một ảnh mẫu.
3. `runStudioImages('chrome-cdp', ...)` kiểm tra digest và file mẫu; nếu thiếu baseline form Shopee, đọc form dưới `productTask`, rồi thả khóa Shopee.
4. Mỗi prompt đính kèm lại ảnh mẫu đã chọn. Bản hiện tại dùng **cùng ảnh mẫu được chọn cho cả 5 lượt**, không có 5 ô ảnh mẫu độc lập.
5. Trình tự bắt buộc: gửi prompt N → nhận diện đúng lượt phản hồi → đợi ảnh hoàn chỉnh → tải bytes gốc → validate/chuyển PNG → lưu app/Drive và cập nhật preview → mới gửi N+1.
6. Giữ `1.png…5.png` theo slot, không gán bằng thứ tự tải xuống ngẫu nhiên. Không lưu screenshot/canvas/progress thumbnail làm ảnh kết quả.
7. Ảnh gốc nguồn PNG/JPEG/WebP, tối đa 25 MiB, ít nhất 500×500, không quá 40 triệu pixels, không ảnh động; decode kiểm chứng bằng Sharp.
8. PNG Drive là PNG thật, có thể >2 MB. Bản JPEG phục vụ publish được nén riêng **<1.900.000 bytes**; không upload PNG lớn lên Shopee.
9. Sau mỗi ảnh, UI có preview mới. `onImage` phải được await đến khi lưu Drive và state xong; không gửi song song 5 prompt.
10. Khi đủ 5 ảnh hợp lệ mới cho attach Notion. Giữ các ảnh đã lưu nếu lượt sau lỗi.

Drive local:

```text
G:\My Drive\Hình ảnh Shopee\Sản phẩm thay thế\
  <shop>\
    <tên sản phẩm mới>\
      1.png
      2.png
      3.png
      4.png
      5.png
      srm-manifest.json
```

- Tên path được chuẩn hoá; không path traversal/symlink ra ngoài root. Tên trùng của sản phẩm khác có hậu tố ID để không ghi đè ảnh.
- Manifest khóa job/identity/hash/slot; hỗ trợ giữ slot từng phần khi bị ngắt.
- Root local phải tồn tại và ghi được. Máy mới chọn root thực tế của Drive Desktop; không mặc định máy nào cũng có ổ G.
- Tool chỉ xác minh file local. Google Drive Desktop tự đồng bộ; chưa có Drive API/OAuth, chưa chứng minh upload cloud xong.
- `G:\...` không phải URL dùng được trên web/Notion. Link Drive gốc chỉ là nguồn tham khảo, không phải link trực tiếp từng file/thư mục con.

Notion ảnh:

- Nhân viên bấm attach; bản JPEG nhỏ được upload/đính kèm thật vào bài Notion và giữ PNG tại Drive local. Tốn thêm dung lượng bản sao Notion và thời gian upload.
- Dùng stable Notion page/block references, resolve lại URL file khi cần; không coi signed file URL tạm là link bền vững.
- `attach()` kiểm tra đúng bài, digest, đủ 5 ảnh, marker chống append lặp rồi đọc lại JSON ảnh.
- Sau attach, bảng Studio là `Đủ bài và ảnh`, `imagesReady:true`, gắn link bài vào sản phẩm nguồn. Chưa sửa Shopee.
- Đường manual import cũ có thể lưu JPEG `1.jpg…5.jpg`; không nhầm với hợp đồng PNG của đường CDP mới.

### Bước 3 — áp dụng lên Shopee

1. Chọn bài đủ text + 5 ảnh, `studio-activate` tạo bản xem trước qua `replacements.prepare(..., {preserveStock:true})`.
2. Kiểm tra shop/ID/tên nguồn, form hiện tại và các trường dấu `*` đỏ. Không hardcode tất cả ngành hàng vào một form.
3. Bài đầu tiên có thể là text-only; `hydrate()` bổ sung category/fields/variants từ baseline form thật trước khi cập nhật.
4. Nhân viên xem plan và bấm chạy. Tool mở đúng profile và đúng sản phẩm, đổi nội dung/giá, thay ảnh cũ bằng ảnh mới theo plan, validate trường bắt buộc rồi cập nhật.
5. Chỉ thông báo thành công sau khi đọc lại Shopee xác minh. Lưu một lần; nếu kết quả không rõ, giữ `uncertain`.
6. Cột **Cần thay thế**: không link → trống; link bài mới → **Chưa thay thế**; Shopee đã lưu và xác minh → **Đã thay thế**. Cùng link đã xong giữ trạng thái; đổi link trở về chưa thay thế.
7. Nếu Notion lỗi sau thành công Shopee, retry phần Notion, không gửi lại sửa Shopee.

Không tự đổi tồn kho chỉ vì tạo bài mới. Luồng Studio prepare dùng `preserveStock:true`; kiểm tra tồn thực tế trước áp dụng. Không tự tạo dữ kiện bắt buộc thiếu, không xoá ảnh hiện có trước khi đã chuẩn bị bộ ảnh mới hợp lệ và plan được người dùng chạy.

### Xoá nháp

- Nút xoá xử lý local tức thì, không native confirm làm treo focus.
- `canDeleteDraft`: trạng thái draft/generated/approved, chưa `notionUrl`, chưa `publishAttempted`, không có asset/lịch sử ảnh cần bảo toàn.
- Soft delete bằng `deletedAt`, không xoá file ảnh hoặc bài Notion.
- UI giữ DOM nguồn qua các snapshot để chọn sản phẩm tiếp theo ngay, kể cả item đang checked; tránh render lại gây mất click/selection.
- Test đã có cho xoá, chọn tiếp, sửa draft khác và persistence sau restart. Live UX nên kiểm tra lại sau sửa UI.

## 7. Kiến trúc code và các điểm vào

Main process CommonJS, renderer JavaScript/HTML/CSS thuần, Electron IPC qua preload. `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`; renderer chỉ gọi allowlist.

| File/nhóm | Vai trò |
|---|---|
| `src/main.cjs` | Khởi tạo service, dataDir, safeStorage, IPC, scheduler, tray/startup, khóa thao tác |
| `src/preload.cjs` | `window.srm.call()` và `subscribe()`, allowlist IPC |
| `src/index.html`, `src/style.css`, `src/renderer.js` | Khung UI, profile, cài đặt, hoàn/huỷ |
| `src/core.cjs` | `Store`, profiles/previousNames, orders/jobs, fresh evidence và eligibility |
| `src/scanner.cjs` | Context Shopee riêng, scan/scroll trang hoàn/huỷ, đọc màu và text |
| `src/sheets.cjs` | CSV mới, validate headers, index/strict match mã đơn/vận đơn |
| `src/integrations.cjs` | Notion/Telegram, queue, dedup, archive bảng hoàn/huỷ |
| `src/configuration.cjs` | Validate import JSON kết nối và Notion IDs |
| `src/products.cjs` | Kho sản phẩm Notion, mapping shop/profile, actions, batch, reconciliation |
| `src/product-scanner.cjs` | Quét 48/trang, search/đọc/sửa giá-kho thật |
| `src/product-batch-ui.js` | Bản nháp, xem trước, chạy batch, giữ item lỗi |
| `src/interface-monitor.cjs`, `src/interface-ui.js` | Baseline DOM/CSS, reports, cảnh báo |
| `src/replacements.cjs` | `ReplacementManager`, Notion article/link, prepare/run/sync plan |
| `src/replacement-editor.cjs` | Đọc form Shopee, trường bắt buộc, thực thi/verify thay bài |
| `src/replacement-date.cjs` | Chuẩn hoá/validate trường ngày |
| `src/replacement-images.cjs` | Tải/validate/nén ảnh bằng Sharp, allowlist nguồn |
| `src/replacement-notion-images.cjs` | Upload/resolve/attach ảnh Notion, marker chống trùng |
| `src/replacement-status.cjs` | Cột Cần thay thế và quy tắc trạng thái |
| `src/replacement-ui.js`, `src/replacement-ui.css` | UI đọc form/xem trước/chạy thay bài |
| `src/replacement-studio.cjs` | `ReplacementStudio`, lifecycle bài/ảnh, hydrate, publish, attach, activate |
| `src/studio-ui.js`, `src/studio-ui.css` | UI Studio ba bước, cấu hình, draft selection/preview |
| `src/studio-settings.cjs` | Defaults, validate key/model/path cấu hình Studio |
| `src/studio-gemini.cjs` | Models/test/write/retry Gemini |
| `src/studio-prompts.cjs` | Thư viện prompt viết bài CRUD, lưu prompts.json |
| `src/prompts/shopee-images.json` | 5 mẫu prompt ảnh |
| `src/studio-reference.cjs` | Nội dung bài tham khảo cho prompt |
| `src/studio-drive.cjs` | `LocalDrive`, folder/manifest/uploadOne/uploadSet, PNG/JPEG |
| `src/studio-chatgpt.cjs` | `ChatGPTImages`, profile CDP, open/test/generate/original, journal |
| `src/chatgpt/chatgpt-session.js` | Endpoint ownership, target ID, ready, kết nối bound tab |
| `src/chatgpt/chatgpt-attachment.js` | Upload đúng composer; filechooser để phân biệt nhiều file input |
| `src/chatgpt/chatgpt-composer.js` | Tìm editor, điền/đọc lại prompt |
| `src/chatgpt/chatgpt-image-request.js` | Xác minh đúng lượt user/assistant, tiến trình, candidate |
| `src/chatgpt/chatgpt-generated-image.js` | Điều kiện ảnh generated hoàn chỉnh |
| `src/studio-manual.cjs`, `src/studio-manual-files.cjs` | Nhập ảnh/clipboard/file picker dự phòng, file identity |
| `src/studio-chrome-bridge.cjs` | Bridge extension legacy localhost 9223 và journal |
| `src/studio-chrome-pairing.cjs` | Pairing lưu mã hoá bằng safeStorage |
| `src/chrome-image-extension/` | Service worker/content/popup/guards/manifest của luồng extension cũ |

IPC quan trọng để trace:

| IPC | Đường xử lý |
|---|---|
| `scan`, `refresh-sheet` | Quét mới Shopee + Sheet, không đối chiếu chỉ bằng cache |
| `products-scan/load/edit/edit-batch/sync/stop-batch` | Module 2 và đồng bộ |
| `interfaces-check/report/accept` | Kiểm tra/đọc/chấp nhận baseline phù hợp |
| `studio-create/update/delete-draft/generate/publish/load` | Bài Studio |
| `studio-config/models/test` | Cấu hình và API Gemini |
| `studio-chatgpt-open`, `studio-chatgpt-test` | Mở/kết nối và kiểm tra Chrome riêng |
| `studio-image-prompts`, `studio-image-reference-pick` | Chuẩn bị prompt/digest và ảnh mẫu |
| `studio-cdp-run` | Primary 1.6.10 → `runStudioImages('chrome-cdp', ...)` |
| `studio-chrome-run` | Legacy → `runStudioImages('chrome-extension', ...)` |
| `studio-images-import` | Nhập 5 ảnh local dự phòng |
| `studio-attach`, `studio-activate` | Gắn ảnh Notion, chọn plan thay bài |
| `replacements-prepare`, `replacements-run` | Chuẩn bị và thực thi thay sản phẩm |

Tên IPC dùng dấu `-` đầy đủ trong source, ví dụ `products-edit-batch`. Cột viết gộp bằng `/` trong bảng là nhóm tên để tìm, không phải literal IPC.

## 8. Khóa trình duyệt, lịch và tránh chạy lặp

### Khóa và lịch

- `scan()` không chạy chồng scan khác hoặc khi `products.busy`/đang xoá Notion.
- `productTask()` dùng cờ `products.busy`, khóa các thao tác Shopee giữa module 2/replacement/inspect.
- `productTask.finally` nhả khóa và gọi lượt hoàn/huỷ nếu đã đến hạn.
- Timer kiểm tra mỗi 5 giây. `plan()` đặt `nextScan = now + intervalMinutes`; lưu cấu hình hoặc scan kết thúc có thể đặt lại mốc. Đây là chu kỳ từ lúc plan/hoàn tất, không cron theo giờ cố định và không replay mọi kỳ bị bỏ lỡ.
- `runStudioImages()` chỉ giữ `productTask` lúc đọc baseline/hydrate. Thời gian ChatGPT tạo ảnh dùng profile riêng, không giữ khóa Shopee suốt nhiều phút.
- Không gom toàn bộ generate-images vào `productTask`: sẽ làm lịch hoàn/huỷ bị chặn.
- `keepAwake` chỉ start power blocker khi `autoScan` bật. App không phải Windows Service; không chạy khi máy tắt/ngủ thủ công/logout.
- Nút X có thể chỉ ẩn xuống tray. Để backup/update phải thoát hẳn app qua tray, không chỉ đóng cửa sổ.

### Trạng thái không được xoá để retry

- Giá/kho: actions `preparing/submitted` qua restart thành `uncertain`; batch running bị interrupted/cancel pending, không tự tiếp tục.
- Studio: generating bài qua restart về draft; generating-images thành images-uncertain; publishing thành publish-uncertain; attaching thành attach-uncertain.
- ChatGPT lưu `submitted` **trước khi click Send**. Nếu lỗi sau click, có thể provider đã nhận: giữ uncertain và kiểm tra lượt cũ.
- Journal hash khóa job, nội dung, ảnh tham khảo và turns. Thay prompt sau khi gửi không cho phép tự chạy lại lượt cũ.
- Notion dùng query/reconcile trước create/append, cờ attempted lưu trước request. Timeout không đồng nghĩa chưa ghi.
- Notion không có unique constraint/create-if-absent nguyên tử. Chỉ nên một máy writer cho cùng bảng; chưa có distributed lock.

## 9. Chrome CDP chính và extension legacy

### CDP 1.6.10

- `ChatGPTImages.profile()` → `chatgpt-studio/profile-cdp`.
- Launcher dùng Chrome thật với URL ChatGPT, user-data-dir riêng, remote debugging trên loopback và port 0, no-first-run/no-default-browser-check. Không có `--enable-automation` trong launcher.
- `ownedEndpoint()` đọc `DevToolsActivePort` tại chính profile và đối chiếu `/json/version`. Không hardcode cổng đọc được từ một lần chạy.
- `bindChatGptSession()` pin endpoint + profile + targetId; không tự nhảy sang tab ChatGPT khác. Fallback cũ dùng `Browser.getBrowserCommandLine` chỉ khi ownership file chưa xác minh được.
- `connectOverCDP(..., {noDefaults:true})` trong session helper; kết nối và ngắt không có nghĩa đóng Chrome của người dùng.
- `open()` hiện bind ngay khi mở; **chưa có mode/nút đăng nhập thường không Debug**.
- `test()` báo login required nếu chưa ready, không gửi prompt.
- Attachment nhiều input: ưu tiên composer; khi không duy nhất, mở menu Thêm ảnh và bắt `filechooser` để nhận đúng input. Không lấy ngẫu nhiên input đầu tiên.
- Image tracker phải xác nhận đúng turn marker, user prompt mới, assistant theo sau, không generating, đủ ảnh/controls/stability; validate lại trước/sau fetch.
- Tải source bytes thật từ nguồn được phép, không screenshot hoặc export canvas.

Lưu ý cấu hình: `studio-settings.cjs` còn `chatgptPort:9222` để tương thích cũ. Luồng primary 1.6.10 dùng endpoint port tự chọn trong profile, không phải cứ đổi ô 9222 là đổi cổng launcher. README đoạn cũ nói `chatgpt-studio/profile` và port 9222 đã lạc hậu; ưu tiên source + phần cuối README “Chrome riêng và ảnh PNG (1.6.10)”.

### Extension cũ

Vẫn giữ code/data để tương thích, **không tự bật lại làm primary** khi user muốn Chrome riêng mà chưa chứng minh workflow mới.

- `src/chrome-image-extension/README.md`, `BRIDGE-CONTRACT.md` mô tả giao thức.
- Bridge `127.0.0.1:9223`, pin Origin extension, capability token mã hoá local, token không đưa vào content/page.
- Pairing code 128-bit, dùng một lần, không hết hạn theo thời gian nhưng bị huỷ khi đóng tool/tạo mã mới/ngắt; capability sau ghép nhớ đến khi revoke.
- Sau mở lại Chrome, người dùng chọn tab; không tự chiếm tab. Document/tab/command identity và no-replay giữ xuyên restart.
- Endpoint `/pair`, `/resume`, `/poll`, `/event`, `/image`; trình tự ACK/claimed/submitted phải giữ nguyên.
- **Fix attachment bằng Playwright CDP không tự sửa content script của extension.** Không hứa luồng extension đã hết lỗi “không nhận diện duy nhất ô đính kèm” nếu chưa kiểm chứng riêng.
- Không xoá pairing/journal khi chuyển transport. Không điều khiển Chrome đang dùng hàng ngày trái lựa chọn của người dùng.

## 10. Dữ liệu local, bảo mật và chuyển máy

### Hai data root khác nhau

| Chế độ | Data root | Electron userData |
|---|---|---|
| Chạy source mặc định | `D:\Codex\ShopeeReturnManager\data` | Theo Electron dev nếu không override |
| Bản cài | `%APPDATA%\ShopeeReturns\data` | `%APPDATA%\ShopeeReturns\electron` |
| Có `SRM_DATA_DIR` | Đường dẫn override | `<SRM_DATA_DIR>\electron` |

Trên máy này bản cài dùng `C:\Users\datdt\AppData\Roaming\ShopeeReturns\data`. Không thấy data trong dev root rồi kết luận người dùng mất dữ liệu. Không trỏ test vào data thật.

| Đường dẫn tương đối data root | Nội dung |
|---|---|
| `state.json` | Profiles, orders, jobs, logs, settings, replacementStudio settings |
| `credentials.enc` | Token Notion/Telegram/Gemini mã hoá safeStorage |
| `profiles/<uuid>/` | Browser profile Shopee |
| `products.json` | Rows, shop mapping, actions và batch |
| `interface-monitor/` | Baselines, cảnh báo và reports |
| `notion-backups/` | Backup trước archive hoàn/huỷ nếu có |
| `replacements/state.json` | Links, template/plan/actions thay sản phẩm |
| `replacement-studio/state.json` | Jobs bài/ảnh, status/digest/link và logs |
| `replacement-studio/prompts.json` | Prompt viết bài tùy chỉnh |
| `replacement-studio/` | Các assets/bản JPEG phục vụ publish theo job |
| `chatgpt-studio/profile-cdp/` | Phiên ChatGPT riêng primary |
| `chatgpt-studio/<jobId>/journal.json` | CDP turn journal/no-replay |
| `chatgpt-studio/<jobId>/1.png…5.png` | Ảnh PNG app-owned |
| `chrome-image-studio/<jobId>/journal.json` | Extension legacy command journal |
| `chrome-pairing.enc` | Capability ghép extension mã hoá |

Có thể còn profile/asset legacy; bảo toàn chúng, không dọn chỉ vì không được liệt kê.

Nguyên tắc:

- Không hardcode, in ra, gửi Git hoặc đưa vào screenshot token/mật khẩu/cookie.
- Không giải mã `credentials.enc` chỉ để đọc bàn giao. Cấu hình UI expose cờ configured, không expose giá trị key.
- Backup cả `%APPDATA%\ShopeeReturns` khi app và browser liên quan đã đóng để gồm cả key storage của Electron; giữ nguyên appId `vn.shopeereturns.desktop` và path qua update.
- Cài bản mới đè cùng máy/cùng Windows user giữ dữ liệu; chuyển máy cần nhập key và đăng nhập lại, không hứa encrypted credentials dùng được máy khác.
- JSON import kết nối chỉ nhận: `notionToken`, `telegramToken`, `chatId`, `sheetUrl`, `notionPageId`, `notionDatabaseId`, `intervalMinutes`, `autoScan`, `notionEnabled`, `telegramEnabled`, `startWithWindows`, `keepAwake`, `closeToTray`.
- Gemini nhập ở cấu hình Studio; không mặc định file JSON import kết nối nhận thêm Gemini key.
- File import có plaintext secret: để local ngoài repo, không đưa vào handoff/zip source. Chỉ mô tả field, không chép giá trị thật.
- Ảnh lỗi người dùng đã gửi có thể lộ tài khoản/mật khẩu ở vùng khác của màn hình. Không embed nguyên ảnh đó vào tài liệu/repo, không trích credentials từ ảnh.

## 11. Notion, Sheet, Drive và hợp đồng dữ liệu

| Nguồn/đích | Link hoặc ID |
|---|---|
| Shopee seller | `https://banhang.shopee.vn/` |
| Hoàn/huỷ | `https://banhang.shopee.vn/portal/sale/returnrefundcancel` |
| Sản phẩm | `https://banhang.shopee.vn/portal/product/list/live/all?operationSortBy=recommend_v2` |
| Sheet đối chiếu | `https://docs.google.com/spreadsheets/d/1_hGDSYB7W5fwubSg9glDXFFzIKIewqcD3le68mr-5Yk/edit?gid=0` |
| Trang Notion Quản lý đơn hàng | `3d970655a9aa801ca5adfe0e07f32c4a` |
| Bảng hoàn/huỷ user đưa | `https://app.notion.com/p/3d970655a9aa81aeb0bcceae0006c7b6?v=3d970655a9aa81a89cc3000cf98ef3c8` |
| Trang cha sản phẩm online | `https://app.notion.com/p/s-n-ph-m-online-3e070655a9aa80d68197fb688ad8e289` |
| Bảng sản phẩm nguồn | `https://app.notion.com/p/3e070655a9aa816c98f4dc2c863fa5bb?v=3e070655a9aa81f1a2a5000c1380d3f4` |
| Bảng Studio lưu local | `3ec70655-a9aa-8170-99c5-d877cdb5daa9` — revalidate qua API trước mutation |
| Drive root ảnh thay thế | `https://drive.google.com/drive/u/2/folders/1rb6h7JS0_5Yo5BQkOQ-7S4GajPxQ_R_3` |
| Drive tham khảo ban đầu | `https://drive.google.com/drive/u/2/folders/1yHmjfkK_41sm20X0YxpzOXxepEZMau6B` |
| Bài Shopee tham khảo | `https://shopee.vn/product/1474107882/46268625740/` |

Thư mục Drive tham khảo ban đầu là ảnh **Oximin**, không phải Thông Tọa. Người dùng đã chọn **giữ sản phẩm Thông Tọa** cho bài mẫu lúc đó, không tự dùng ảnh sai bao bì. Với tác vụ mới, nhân viên chọn đúng ảnh mẫu sản phẩm mới.

Notion integration cần được cấp quyền các trang/bảng tương ứng. ID/view URL không phải token. Một số parent/database IDs hiện còn hardcode trong module sản phẩm/replacement; clone code cho người khác không đồng nghĩa tự dùng được tài nguyên Notion/Sheet của chủ repo. Cần cấu hình/cấp quyền tương ứng và có thể phải tham số hoá IDs nếu dùng workspace Notion khác.

Schema chính:

- Kho sản phẩm: `Tên sản phẩm` title; `Tên shop`, `ID sản phẩm`, `Model ID`, `Phân loại` rich_text; `Giá bán`, `Kho hàng` number; `Quét lúc` date; `Sản phẩm thay thế` URL; `Cần thay thế` select.
- Studio: `Tên sản phẩm` title; `Tên shop`, `Sản phẩm nguồn`, `ID sản phẩm`, `Model ID`, `Insight`, `Mã tác vụ` rich_text; `Giá bán` number; `Trạng thái` select (`Bài đã duyệt`, `Đủ bài và ảnh`); `Thư mục ảnh` URL. `Insight` còn trong schema legacy dù UI không tạo nhiều insight.
- Kiểu cột không tương thích phải báo lỗi, không tự đổi kiểu hoặc xoá dữ liệu của người quản lý.

Hợp đồng JSON bài thay thế (`replacements.validateArticle`):

```text
schemaVersion: 1
target: { shop, productId, name }              # identity nguồn, khớp tuyệt đối
product: {
  name, description, category,
  fields: { <nhãn form>: <giá trị> },
  variants: [{ modelId, name, price, stock }]
}
images: [ <link từng ảnh / Notion block reference> ]
imageFolder?: <HTTPS folder reference>
approved?: boolean
```

- Bài ở bước viết có thể chỉ gồm product name/description và `images:[]`; chưa đủ chạy Shopee.
- Full article phải có category/fields/variants hợp lệ; target khớp shop/productId/tên nguồn, ID số giữ dạng string.
- General replacement validator nhận 1–9 ảnh; **Studio yêu cầu đúng 5 ảnh**.
- `images` không nhận URL thư mục Drive; dùng link từng ảnh hoặc Notion block hợp lệ đã resolve.
- `approved:true` là điều kiện backend, không đồng nghĩa nhân viên phải bấm nút duyệt riêng ở UI.
- Full plan TTL hiện 10 phút; đọc lại và prepare lại khi hết hạn/thay đổi nguồn, không ép chạy plan cũ.

## 12. Bằng chứng kiểm thử và giới hạn xác minh

### Release 1.6.10 đã có

| Bằng chứng | Nội dung |
|---|---|
| `work/tests-v1610-final.log` | 246 tests: **245 pass, 1 skipped, 0 failed** |
| `work/check-v1610.log` | `npm run check` đã chạy ở release 1.6.10 |
| `work/build-v1610.log` | Build NSIS/x64 thành công, signing skipped |
| `work/release-v1610-verification.json` | Manifest release: 13 UI/integration suites, packaged checks, liveChatGPTVerified=false |
| `work/release-v1610-smoke.cjs` | Harness smoke bản đóng gói |
| `work/release-v1610-verify.cjs` | Verify package/source/resources |
| `work/studio-v1610.png` | Ảnh UI local của bản kiểm thử |
| `work/chatgpt-login-diagnostic.json` | Metadata sự cố auth ngày 02/10, không có credential |

Lượt release trước đã xác minh ASAR/source, manifest/resources extension, restart/revoke/persistence, chooser CDP, sequential PNG/preview, quét hoàn huỷ trong lúc CDP đang chờ, xoá nháp/restart, cài app và dữ liệu được giữ. Lượt viết handoff này **chỉ đọc lại evidence**, kiểm tra version cài và tính lại SHA-256 installer; không chạy lại toàn bộ tests/build.

**`work/ui-v1610.log` không phải log toàn bộ xanh.** Nó chứa lần chạy dừng ở `studio-chrome-ui.cjs` vì fixture cũ click nút extension đã ẩn. Fixture sau đó được sửa và các suite còn lại đã được chạy riêng theo bàn giao trước; manifest ghi tổng 13 suite. Khi sửa mới, chạy lại suite liên quan để có bằng chứng mới, không trích đoạn log lỗi như một lần full pass.

### Tests cần biết

| Phạm vi | Test |
|---|---|
| Hoàn/huỷ, fresh matching, queue | `core.test.cjs`, `scanner.test.cjs`, `sheets.test.cjs`, `strict-match.test.cjs`, `notion-reset.test.cjs`, `configuration.test.cjs` |
| Sản phẩm, batch, số mới | `products.test.cjs`, `product-scanner.test.cjs`, `product-fresh-edit.test.cjs`, `products-ui.cjs`, `product-batch-ui.cjs` |
| DOM/CSS monitor | `interface-monitor.test.cjs`, `interface-ui.cjs` |
| Replacement/ảnh/form | `replacements.test.cjs`, `replacement-editor.test.cjs`, `replacement-date.test.cjs`, `replacement-images.test.cjs`, `replacement-notion-images.test.cjs`, `replacement-ui.cjs` |
| Bài/Gemini/setting/prompt | `replacement-studio.test.cjs`, `gemini-connection.test.cjs`, `studio-settings.test.cjs`, `studio-prompts.test.cjs`, `studio-ui.cjs`, `gemini-status-ui.cjs` |
| CDP thật với trang fixture | `studio-cdp-flow.test.cjs` |
| Electron IPC + CDP fixture + lịch hoàn huỷ | `studio-cdp-integration.cjs` |
| Streaming/PNG/Drive/no-replay | `studio-streaming.test.cjs`, `studio-adapters.test.cjs` |
| Xoá nháp, focus, selection, restart | `studio-draft-delete-ui.cjs` |
| Manual import | `studio-manual.test.cjs`, `studio-manual-files.test.cjs`, `studio-manual-ui.cjs` |
| Extension legacy/pairing | `chrome-image-extension.test.cjs`, `chrome-image-attachment.test.cjs`, `chrome-pairing-storage.test.cjs`, `studio-chrome-bridge.test.cjs`, `chrome-pairing-persistence.cjs`, `studio-chrome-ui.cjs`, `studio-chrome-integration.cjs` |

Tất cả tên trong bảng nằm dưới `tests/`. UI suites dùng Electron thật nhưng tích hợp bên ngoài chủ yếu là fixtures; “real browser” không có nghĩa “real provider”. Chưa có live verification đầy đủ cho ChatGPT image + Notion attach + thay bài Shopee của workflow mới.

## 13. Chạy, test, build và cập nhật

### Chạy development

```powershell
Set-Location -LiteralPath 'D:\Codex\ShopeeReturnManager'
npm ci
npm run check
npm test
```

`npm ci` cần khi chuẩn bị môi trường/dependencies, không cần chạy lại chỉ để đọc tài liệu. Đã có `node_modules` trên máy hiện tại. Không sửa `package-lock.json` ngoài phạm vi.

`npm start` hoặc `Start.cmd` dùng data dev mặc định và có thể quét khởi động. Nếu chỉ xem UI/test độc lập, dùng một thư mục riêng và driver mode:

```powershell
Set-Location -LiteralPath 'D:\Codex\ShopeeReturnManager'
$env:SRM_DATA_DIR = Join-Path (Get-Location) ('work\anti-smoke-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$env:SRM_DRIVER = '1'
try {
    npm start
} finally {
    Remove-Item Env:SRM_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:SRM_DRIVER -ErrorAction SilentlyContinue
}
```

Driver mode chỉ dành cho test: exposes `app.srmDriver` và bỏ initial scan. Nó không phải chế độ production. Không nhập credential thật/bấm tác vụ remote trong data test nếu không đang kiểm chứng thao tác đó. Single-instance lock có thể đưa focus về app đã mở; đóng đúng instance trước nếu test cần instance độc lập, không kill mọi Chrome.

### Test theo phạm vi

```powershell
npm run check
node --test tests/studio-cdp-flow.test.cjs tests/studio-streaming.test.cjs
node tests/studio-cdp-integration.cjs
node tests/studio-draft-delete-ui.cjs
```

Sau thay đổi rộng hơn:

```powershell
npm test
npm run test:ui
```

UI script chạy 13 suites tuần tự. Tránh chạy nhiều suite Electron chồng nhau nếu có tranh cổng/focus/instance. Tests unit nằm `*.test.cjs`, UI/integration `.cjs` riêng không tự có trong `npm test`.

### Build bản cài

```powershell
npm run build:win
Get-FileHash -LiteralPath 'dist\Shopee-Returns-Setup-1.6.10-x64.exe' -Algorithm SHA256
```

Lệnh hash trên dành cho version hiện tại; khi có release mới đổi tên theo version thật. Không build ghi đè artifact 1.6.10 chỉ để tạo handoff.

- NSIS per-user, có chọn thư mục, giữ app data khi uninstall (`deleteAppDataOnUninstall:false`). `runAfterFinish:false`.
- `dist/win-unpacked` để smoke; extension thêm vào resources bằng `extraResources`.
- Không có auto updater. Máy khác cài installer mới để update; giữ data local ngoài program directory.
- Trước cài: thoát app thật, backup cả dữ liệu app và bảo toàn browser profiles. Không mang profile/token vào installer.
- Sau cài: kiểm tra version exe, ASAR/source, mở app đúng instance, dữ liệu/profile/cấu hình còn nguyên.
- Bump version/package-lock khi thực sự phát hành; không tự commit/push. Chỉ tạo PR/đẩy GitHub khi user yêu cầu.

## 14. Tiêu chí nghiệm thu cho phần đang vướng

Anti chỉ báo xong luồng tạo ảnh khi có các bằng chứng thực tế sau:

1. Chrome là profile riêng đã xác định; user đăng nhập ChatGPT thành công, app nhận ready đúng tab.
2. Chọn đúng một trong các bài người dùng muốn xử lý, prompt digest khớp bài Notion và ảnh mẫu đúng sản phẩm.
3. Prompt 1 có ảnh mẫu thật, chỉ gửi một lần. Nhận ảnh của đúng turn, không lấy ảnh cũ.
4. `1.png` tồn tại đúng thư mục shop/tên mới, PNG magic/decode hợp lệ, preview hiện trên app trước khi gửi prompt 2.
5. Lặp đúng tới `5.png`, không tạo thư mục insight dư, không ghi đè file không thuộc job.
6. Mất mạng/reload/đóng cửa sổ giữ trạng thái chưa xác minh; không tự gửi lại và không mất ảnh đã lưu.
7. Nhân viên bấm attach sau đủ 5 ảnh; Notion đúng bài có đủ ảnh và source link, không trùng blocks.
8. Bản phục vụ Shopee đều dưới giới hạn; chỉ cập nhật sản phẩm thật khi người dùng chọn và chạy plan; đọc lại xác minh trước status done.
9. Lịch hoàn/huỷ vẫn được thực thi nếu đang được người dùng bật; khi test lịch bằng fixture không sửa setting production `autoScan:false` hiện tại.
10. Xoá nháp chưa publish chọn tiếp sản phẩm ngay; hai bài đã publish và lịch sử gửi vẫn còn.

Nếu provider vẫn chặn đăng nhập, báo **blocker bên ngoài chưa giải quyết** cùng bằng chứng, không đánh dấu toàn bộ tính năng hoàn tất và không thay bằng mock rồi báo thành công.

## 15. Tài liệu tham khảo và lưu ý tiếp quản

- `README.md`: mô tả vận hành nhiều phiên bản; các đoạn cũ còn tồn tại. Với Chrome/ảnh, ưu tiên phần 1.6.10 và source hiện tại.
- `D:\Project Anti\MCP Shopee\web_app.py`: code tham khảo cách mở Chrome của tool khác (vùng launcher từng ở khoảng dòng 8730, upload khoảng 8909; tìm lại symbol trước đọc).
- `D:\Project Anti\MCP Shopee\5_PROMPTS_TAO_HINH_CHATGPT.md`: tài liệu 5 prompt người dùng yêu cầu; prompt đã đưa vào `src/prompts/shopee-images.json`.
- `D:\Project Codex\MCP Shopee` cũng từng tồn tại. Không sửa nhầm repo; trong task này MCP Shopee chỉ là tham khảo, source cần sửa là ShopeeReturnManager.
- Không copy mù upload first file input, retry gửi nhiều lần hoặc screenshot fallback từ tool khác; chúng không bảo toàn identity/completion như guards hiện tại.
- `D:\Project Codex\PDF Studio\docs\IMAGE-COMPRESSION-HANDOFF.md`: tham khảo nén ảnh người dùng đưa. Dự án này hiện đã dùng Sharp phía main process; không cần đưa thêm renderer compressor nếu không có lý do cụ thể.
- Các screenshot lỗi auth trong Temp không được đưa vào repo vì có vùng nhạy cảm; ưu tiên JSON diagnostic đã rút gọn.

Quy tắc giao tiếp/làm việc người dùng mong đợi: tiếng Việt có dấu, hành động/kết quả trước, cập nhật ngắn trong khi chạy; tự làm phần đã được giao; hỏi tối đa những dữ kiện thực sự thiếu. Đọc code hiện có trước sửa, thay đổi đúng phạm vi, giữ dữ liệu và lịch sử, test phù hợp, không tự commit/push. Đọc AGENTS/skills của môi trường Anti hiện tại nếu có; handoff là ngữ cảnh dự án, không cấp thêm quyền cho thao tác hệ thống hoặc provider.

### Thứ tự đọc code khuyến nghị cho Anti

1. `src/studio-chatgpt.cjs`: `open`, `test`, `generate`, `original`.
2. `src/chatgpt/chatgpt-session.js` và `chatgpt-attachment.js`.
3. `src/main.cjs`: `runStudioImages`, `productTask`, scheduler.
4. `src/replacement-studio.cjs`: `chromeImages`, `attach`, `canDeleteDraft`, `deleteDraft`.
5. `src/studio-drive.cjs`, `src/studio-ui.js` và tests tương ứng.

Không cần đọc toàn repo hoặc sửa module hoàn/huỷ để xử lý lỗi đăng nhập hiện tại.
