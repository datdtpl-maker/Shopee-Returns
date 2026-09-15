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

Node.js 24, Electron 40, Playwright; Chrome hoặc Edge cài trên máy.

```powershell
npm ci
npm run check
npm test
npm run test:ui
npm start
```

Kiểm thử UI dùng thư mục dữ liệu tạm, không thay trạng thái các đơn thật. Không cần server công khai hay cổng localhost cho giao diện; renderer gọi các thao tác giới hạn qua Electron IPC.

Chưa đóng gói installer. Bản chạy trực tiếp dùng `Start.cmd`.

### Bàn giao dữ liệu cho tool xử lý

Tool này là nguồn cấp dữ liệu thô, chỉ tạo bản ghi mới. Tool nhận dữ liệu có thể đọc và thay đổi Xử lý hoặc bổ sung trường riêng. Không chạy nhiều bản sao tool quét cùng lúc vào một bảng: Notion không có ràng buộc duy nhất/giao dịch tạo-if-absent, nên hai máy đồng thời có thể tạo trùng. Nút Xoá dữ liệu Notion vẫn là thao tác riêng có xác nhận, có thể xoá cả dữ liệu đã được tool khác xử lý.
