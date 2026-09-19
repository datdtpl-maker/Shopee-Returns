# Shopee Return Manager

Ứng dụng Windows quản lý đơn hoàn/huỷ Shopee. Mở `Start.cmd` trong thư mục dự án để chạy.

## Sử dụng

1. Mở **Profile Shopee**, đặt tên tài khoản, chọn **Thêm profile**.
   Bấm **Sửa tên** trên profile, nhập tên mới rồi **Lưu tên**. Giữ nguyên phiên đăng nhập, đơn và trạng thái xử lý. Notion giữ nguyên bản ghi cũ; tên mới chỉ dùng cho đơn chưa được ghi; tên cũ được giữ để đối chiếu và không dùng lại cho profile khác.
2. Chọn **Mở đăng nhập Shopee**, đăng nhập trong cửa sổ Chrome của profile đó. App giữ dữ liệu trình duyệt riêng cho từng profile tại `data/profiles/<id>`.
3. Chọn **Quét profile** hoặc **Quét ngay**. App đọc lại Shopee và Sheet, cuộn đến cuối **một trang hiện tại** của `https://banhang.shopee.vn/portal/sale/returnrefundcancel`; không bấm chuyển trang, hoàn tiền, khiếu nại hoặc xác nhận trên Shopee.
4. Xem mã đơn, profile, mã vận đơn, chữ đỏ/xanh ở cột **Vận chuyển chiều giao hàng**, trạng thái Shopee, kết quả đối chiếu trong app.
   Bấm **Gom nhóm vận chuyển** cạnh bộ lọc để gom các đơn có cùng nội dung trạng thái vận chuyển thành từng nhóm, kèm số lượng. Tìm kiếm và bộ lọc áp dụng trước khi gom nhóm. Bấm **Bỏ gom nhóm vận chuyển** để về danh sách thường; app nhớ lựa chọn khi mở lại.
5. Tool chỉ cung cấp dữ liệu thô. Tool của bên xử lý quản lý tiến độ trực tiếp trên Notion; app không có thao tác thay đổi trạng thái xử lý.
6. Trong **Cài đặt kết nối**, thay chu kỳ 1–1440 phút và bật/tắt lịch. Giữ app và máy hoạt động để quét theo lịch. Đóng app hoặc máy ngủ thì không có lượt quét.

## Google Sheet và Notion

- Sheet mặc định là link người dùng cung cấp, trang `gid=0`. Chỉ đọc Sheet; không sửa dữ liệu gốc.
- Đọc cột **Mã đơn hàng**, **Mã vận đơn**, **Tình trạng**. So toàn bộ mã đơn chính xác sau khi bỏ khoảng trắng hai đầu; không đổi hoa/thường, không so một phần, không đoán mã gần giống.
- Chỉ hiển thị và ghi dữ liệu mới khi mã đơn vừa thấy trên Shopee khớp đúng **một mã vận đơn hợp lệ** trong Sheet vừa tải. Mã vận đơn lấy từ Sheet của quy trình đóng/gửi hàng; đây không phải xác minh độc lập rằng hãng vận chuyển đã nhận kiện hàng.
- Thiếu mã, nhiều mã vận đơn, một vận đơn thuộc nhiều đơn, hoặc các dòng trùng có dữ liệu mâu thuẫn: không hiển thị/gửi. Các mã này vẫn lưu nội bộ để đối chiếu lại và chống trùng khi Sheet bổ sung mã sau đó.
- Mở app sẽ quét mới; không đưa dữ liệu lưu của lần chạy trước lên danh sách. **Đối chiếu ngay** cũng đọc lại cả Shopee và Sheet. Đơn không còn trong trang quét hiện tại không xuất hiện trong danh sách hiện tại, nhưng trạng thái xử lý vẫn lưu nội bộ.
- Trình duyệt tắt cache trong lượt quét, yêu cầu Sheet dùng URL mới và no-cache. Hai dịch vụ được đọc lần lượt, không phải một giao dịch đồng thời; thời điểm đọc hiện trên app. Tần suất mặc định 10 phút, không phải cập nhật liên tục từng giây.
- Lỗi đọc một nguồn: không dùng kết quả cũ của profile đó để hiển thị hoặc gửi. Kết quả hết hạn sau chu kỳ quét đã cài cũng bị ẩn cho đến khi có đối chiếu mới.
- Notion dùng bảng **Theo dõi hoàn huỷ Shopee** dưới trang **Quản lý đơn hàng**. Các trường: mã đơn, profile, mã vận đơn, vận chuyển chiều giao hàng, trạng thái Shopee, tình trạng Sheet, xử lý mặc định và thời gian ghi dữ liệu.
- Các cột thiếu được bổ sung, cột có kiểu khác dự kiến sẽ báo lỗi thay vì ghi đè cấu trúc.
- Notion có hàng đợi lưu trên máy và tự thử lại khi lỗi. Trước khi ghi, tìm chính xác theo **Profile + Mã đơn hàng**; không cần các cột Mã theo dõi, Sheet nguồn, Đối chiếu Sheet.
- Chỉ thêm mới: đơn đã có theo **Profile (kể cả tên cũ) + Mã đơn hàng** được bỏ qua hoàn toàn, không PATCH bất kỳ trường nào, kể cả khi dữ liệu Shopee/Sheet thay đổi. Tiến độ, ghi chú và dữ liệu do người khác sửa trên Notion được giữ nguyên. App vẫn hiển thị kết quả quét mới nhất; dữ liệu thô Notion là ảnh chụp ở lần tạo.
- Mọi bản ghi mới luôn có **Xử lý = Chưa xử lý**, kể cả đơn từng có trạng thái khác trong dữ liệu app cũ. Nếu xoá bản ghi trên Notion, lượt quét mới có thể tạo lại với Chưa xử lý. Nhiều bản ghi cùng khoá sẽ báo lỗi và không tạo thêm. Không đổi Mã đơn hàng/Profile trên Notion vì đây là khoá chống trùng.

## Xoá dữ liệu Notion trước khi quét mới

1. Bấm **Xoá dữ liệu Notion** ở màn hình danh sách hoặc Cài đặt → Notion.
2. Hộp thoại cho biết số bản ghi và yêu cầu xác nhận. App sao lưu vào `data/notion-backups`, rồi đưa toàn bộ bản ghi của bảng vào thùng rác Notion; không xoá bảng/cột, profile, dữ liệu Sheet hoặc trạng thái xử lý trong app.
3. Sau khi kiểm tra bảng đã trống, app chờ **Quét ngay** để ghi lại các đơn đang đủ điều kiện. Lịch tự động tiếp tục sau lượt quét đó; bật/tắt Telegram vẫn được giữ.
4. Nếu mất mạng khi xoá, app giữ trạng thái tạm dừng qua cả lần khởi động lại. Bấm **Thử lại xoá Notion** để hoàn tất trước khi quét. Bản sao lưu ghi lại dữ liệu trước từng lần xoá.

## Telegram

Telegram đang **tắt** để test trong app. Khi cần, nhập Bot Token và Chat ID trong Cài đặt rồi bật.

- Mỗi cặp **profile + mã đơn** có một thông báo. Quét lại hoặc đổi trạng thái vận chuyển không tạo thông báo thứ hai.
- Các đơn phát hiện lúc Telegram đang tắt được giữ trong hàng đợi; bật Telegram chỉ gửi đơn chưa gửi đang đủ điều kiện từ lượt đối chiếu mới.
- Chỉ đánh dấu đã gửi sau khi Telegram trả thành công. Nếu mạng mất sau khi Telegram nhận nhưng trước khi app nhận phản hồi, việc thử lại vẫn có khả năng tạo tin trùng vì Telegram không hỗ trợ khoá idempotency cho sendMessage.

## Dữ liệu và bảo mật

- Trạng thái: `data/state.json`; token: `data/credentials.enc`, mã hoá bằng Electron safeStorage/Windows của người dùng hiện tại. Không trả token về giao diện, không ghi token trong source.
- `data`, `work`, `.env*`, `node_modules` đã được loại khỏi Git. Không chia sẻ thư mục `data` vì chứa phiên đăng nhập và dữ liệu đơn hàng.
- Khi sao lưu, đóng app trước rồi sao lưu toàn bộ `data`. Token đã mã hoá có thể cần nhập lại khi chuyển tài khoản Windows/máy.
- Phiên Shopee có thể hết hạn hoặc yêu cầu xác minh: mở lại profile và tự đăng nhập/xác minh.
- Bộ quét dùng cấu trúc DOM và màu hiển thị thực tế. Nếu Shopee đổi giao diện, kiểm tra nhật ký; giới hạn mỗi lượt 120 giây để tránh treo.
- Một đơn có nhiều yêu cầu hoàn/huỷ vẫn là một bản ghi theo profile; các trạng thái Shopee đọc được được gộp để giữ thông tin.

## Phát triển và kiểm thử

Node.js 24, Electron 44.3.0, Playwright; Chrome hoặc Edge cài trên máy.

```powershell
npm ci
npm run check
npm test
npm run test:ui
npm start
```

Kiểm thử UI dùng thư mục dữ liệu tạm, không thay trạng thái các đơn thật. Không cần server công khai hay cổng localhost cho giao diện; renderer gọi các thao tác giới hạn qua Electron IPC.

Bộ cài Windows x64 tạo bằng `npm run build:win`. Bản chạy mã nguồn vẫn dùng `Start.cmd`.

### Bàn giao dữ liệu cho tool xử lý

Module hoàn huỷ là nguồn cấp dữ liệu thô, chỉ tạo bản ghi mới. Tool nhận dữ liệu có thể đọc và thay đổi Xử lý hoặc bổ sung trường riêng. Không chạy nhiều bản sao tool quét cùng lúc vào một bảng: Notion không có ràng buộc duy nhất/giao dịch tạo-if-absent, nên hai máy đồng thời có thể tạo trùng. Nút Xoá dữ liệu Notion vẫn là thao tác riêng có xác nhận, có thể xoá cả dữ liệu đã được tool khác xử lý.

## Module 2 — Sản phẩm, giá bán và tồn kho (1.2.0)

1. Mở **Sản phẩm**, chọn shop hoặc tất cả profile đang bật, bấm **Quét Shopee → Notion**. Tool dùng phiên đăng nhập hiện có, chọn 48/trang, cuộn đọc giá/tồn kho và đi qua toàn bộ trang đang hoạt động. Chỉ nhận lượt quét đủ số sản phẩm, đúng shop, không trùng ID. Tồn kho rút gọn như 200k được đọc chính xác trong hộp tồn kho rồi huỷ hộp.
2. Bảng **Kho sản phẩm Shopee** nằm trong trang Notion `3e070655a9aa80d68197fb688ad8e289`; dùng token đã nhập ở Cài đặt. Integration phải có quyền trang này. Bảng có Tên shop, Tên sản phẩm, Giá bán, Kho hàng và các trường ID sản phẩm, Model ID, Phân loại, Quét lúc để đối chiếu. Mỗi phân loại là một dòng. Khoá chống trùng là tên tài khoản shop + ID sản phẩm + Model ID; tên profile chỉ là nhãn cục bộ.
3. **Tải dữ liệu Notion** để xem dữ liệu bảng; **Sửa giá / Sửa kho → Lưu lên Shopee** để thực hiện thay đổi. Tool tìm bằng ID, đối chiếu tài khoản, tên sản phẩm, phân loại và giá trị gốc; chỉ sửa ô được chọn, lưu một lần rồi mở lại kiểm tra. Nếu giá khuyến mãi khác giá gốc trong hộp sửa, nhiều kho không xác định được hoặc dữ liệu đã đổi, tool dừng và báo lỗi.
4. Giá/kho được cập nhật lên **bảng sản phẩm** khi khác dữ liệu cũ, không tạo thêm dòng trùng. Các cột khác do người quản lý thêm được giữ lại. `Quét lúc` ghi thời điểm nguồn của lần ghi dữ liệu; dòng không đổi không được ghi lại. Notion là bản chụp tại lần quét, không phải luồng tồn kho liên tục. Sửa trực tiếp Notion không tự sửa Shopee.
5. Nếu Shopee đã lưu nhưng Notion lỗi, bấm **Đồng bộ lại** để chỉ thử ghi Notion. Nếu mất kết nối sau khi gửi lệnh lưu Shopee, tool không tự gửi lại; quét lại shop để xác minh trước khi sửa tiếp. Nhật ký và dữ liệu sản phẩm lưu riêng tại `data/products.json`. Máy mới cần quét shop một lần để liên kết profile với tên tài khoản thật.
6. Trình duyệt vẫn mở sau thao tác. Hai module dùng khoá thao tác để không điều hướng chồng nhau: lịch hoàn huỷ giữ nguyên, nếu đến hạn lúc module 2 đang chạy sẽ chạy ngay khi thao tác xong. Nút **Xoá dữ liệu Notion** hiện có chỉ áp dụng bảng hoàn huỷ; không xoá bảng sản phẩm. Module sản phẩm chạy khi bấm nút, không thêm lịch tự động mới.

Kiểm thử riêng giao diện sản phẩm và lịch chờ: `node tests/products-ui.cjs`. Không thử đổi giá/kho thật nếu chưa có giá trị cụ thể được người vận hành yêu cầu. Chỉ chạy một máy ghi vào cùng bảng Notion để tránh tranh chấp giữa máy.

### Sửa hàng loạt (1.3.0)

1. Lọc shop / tên sản phẩm rồi bấm **Sửa hàng loạt**. Nhập giá mới, kho mới hoặc cả hai cho từng dòng. Ô trống giữ nguyên; kho bằng 0 là hợp lệ. Đóng hộp vẫn giữ bản nháp trên máy, có thể đổi bộ lọc để nhập thêm sản phẩm khác.
2. Bấm **Xem thay đổi** để xem tất cả bản nháp (kể cả sản phẩm ngoài bộ lọc hiện tại), đối chiếu shop, phân loại, giá trị cũ/mới, rồi bấm **Chạy N thay đổi**. Chỉ lúc này tool mới sửa Shopee. Tối đa 1.000 thay đổi mỗi lượt.
3. Tool chạy lần lượt, xác minh và đồng bộ từng trường; một sản phẩm sửa cả giá và kho là hai thay đổi. Mục lỗi được ghi riêng, các mục độc lập vẫn tiếp tục. Nếu một thao tác chưa xác minh được sau khi gửi Shopee, các mục còn lại của sản phẩm đó không được gửi; quét lại shop trước khi sửa tiếp.
4. **Dừng sau mục hiện tại** chờ mục đang thực hiện xong, bỏ qua các mục chưa chạy. Không hoàn tác các mục đã lưu. Kết quả lượt gần nhất được lưu tại `data/products.json`; mở lại app không tự chạy lại các lệnh dở. Bản nháp lưu trong dữ liệu Electron cục bộ, không chứa token.
5. Lịch hoàn huỷ đợi toàn bộ lượt sửa kết thúc/dừng rồi chạy ngay nếu đã đến hạn. Profile vẫn mở. Nếu Shopee đã lưu nhưng Notion lỗi, dùng **Đồng bộ lại**, không chạy lại lệnh sửa Shopee.

Kiểm thử giao diện hàng loạt: `node tests/product-batch-ui.cjs` (dữ liệu giả, không sửa shop thật).

## Bộ cài Windows và dữ liệu lâu dài (1.1.0)

- Cài file Shopee-Returns-Setup-1.1.0-x64.exe. Không cần Node.js; cần Chrome hoặc Microsoft Edge.
- Bản cài lưu toàn bộ dữ liệu dưới %APPDATA%\ShopeeReturns: data/state.json, data/credentials.enc, data/profiles và electron (khoá mã hoá/trạng thái Electron). Không lưu dữ liệu trong thư mục chương trình.
- Cài bản mới đè lên bản cũ, cùng tài khoản Windows, giữ appId và đường dẫn dữ liệu. Đóng app hoàn toàn qua khay hệ thống trước khi cập nhật. Không xoá %APPDATA%\ShopeeReturns. Sao lưu cả thư mục này khi app và browser đã đóng. Chuyển sang máy/tài khoản khác cần nhập lại token và đăng nhập Shopee.
- Cài đặt → Nhập file cấu hình: JSON chỉ nhận các trường notionToken, telegramToken, chatId, notionPageId, notionDatabaseId, sheetUrl, intervalMinutes, autoScan, notionEnabled, telegramEnabled, startWithWindows, keepAwake, closeToTray. Token lưu mã hoá bằng safeStorage tại máy nhận. File nhập chứa token dạng đọc được, cất riêng và không đưa lên repo.
- Bật autoScan và keepAwake để giữ app hoạt động khi màn hình tắt; closeToTray để nút X chỉ ẩn cửa sổ; startWithWindows để mở lại sau khi đăng nhập Windows. App không phải Windows Service và không quét khi máy tắt, ngủ thủ công, đăng xuất hoặc chưa đăng nhập Windows.
- Chỉ chạy một máy quét vào cùng bảng Notion tại một thời điểm. Chưa có khoá phân tán giữa các bản cài.
- Bộ cài chưa có chữ ký số; Windows có thể hiển thị cảnh báo nhà phát hành chưa xác định. Không có cập nhật tự động: chạy bộ cài phiên bản mới để cập nhật.
