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
3. **Tải dữ liệu Notion** để xem dữ liệu bảng; **Sửa giá / Sửa kho → Lưu lên Shopee** để thực hiện thay đổi. Tool tìm bằng ID, đối chiếu tài khoản, tên sản phẩm và phân loại; đọc giá/kho mới nhất từ Shopee rồi đối chiếu với hộp sửa; chỉ sửa ô được chọn, lưu một lần rồi mở lại kiểm tra. Nếu giá khuyến mãi khác giá gốc trong hộp sửa, nhiều kho không xác định được hoặc giá/kho tiếp tục đổi giữa lúc đọc và mở hộp, tool dừng và báo lỗi.
4. Giá/kho được cập nhật lên **bảng sản phẩm** khi khác dữ liệu cũ, không tạo thêm dòng trùng. Các cột khác do người quản lý thêm được giữ lại. `Quét lúc` ghi thời điểm nguồn của lần ghi dữ liệu; dòng không đổi không được ghi lại. Notion là bản chụp tại lần quét, không phải luồng tồn kho liên tục. Sửa trực tiếp Notion không tự sửa Shopee.
5. Nếu Shopee đã lưu nhưng Notion lỗi, bấm **Đồng bộ lại** để chỉ thử ghi Notion. Nếu mất kết nối sau khi gửi lệnh lưu Shopee, tool không tự gửi lại; quét lại shop để xác minh trước khi sửa tiếp. Nhật ký và dữ liệu sản phẩm lưu riêng tại `data/products.json`. Máy mới cần quét shop một lần để liên kết profile với tên tài khoản thật.
6. Trình duyệt vẫn mở sau thao tác. Hai module dùng khoá thao tác để không điều hướng chồng nhau: lịch hoàn huỷ giữ nguyên, nếu đến hạn lúc module 2 đang chạy sẽ chạy ngay khi thao tác xong. Nút **Xoá dữ liệu Notion** hiện có chỉ áp dụng bảng hoàn huỷ; không xoá bảng sản phẩm. Module sản phẩm chạy khi bấm nút, không thêm lịch tự động mới.

Kiểm thử riêng giao diện sản phẩm và lịch chờ: `node tests/products-ui.cjs`. Không thử đổi giá/kho thật nếu chưa có giá trị cụ thể được người vận hành yêu cầu. Chỉ chạy một máy ghi vào cùng bảng Notion để tránh tranh chấp giữa máy.

### Sửa hàng loạt (1.3.0)

1. Lọc shop / tên sản phẩm rồi bấm **Sửa hàng loạt**. Nhập giá mới, kho mới hoặc cả hai cho từng dòng. Ô trống giữ nguyên; kho bằng 0 là hợp lệ. Đóng hộp vẫn giữ bản nháp trên máy, có thể đổi bộ lọc để nhập thêm sản phẩm khác.
2. Bấm **Xem thay đổi** để xem tất cả bản nháp (kể cả sản phẩm ngoài bộ lọc hiện tại), đối chiếu shop, phân loại, giá trị cũ/mới, rồi bấm **Chạy N thay đổi**. Chỉ lúc này tool mới sửa Shopee. Tối đa 1.000 thay đổi mỗi lượt.
3. Tool chạy lần lượt, xác minh và đồng bộ từng trường; một sản phẩm sửa cả giá và kho là hai thay đổi. Mục lỗi được ghi riêng, các mục độc lập vẫn tiếp tục. Nếu một thao tác chưa xác minh được sau khi gửi Shopee, các mục còn lại của sản phẩm đó không được gửi; quét lại shop trước khi sửa tiếp.
4. **Dừng sau mục hiện tại** chờ mục đang thực hiện xong, bỏ qua các mục chưa chạy. Không hoàn tác các mục đã lưu. Kết quả lượt gần nhất được lưu tại `data/products.json`; mở lại app không tự chạy lại các lệnh dở. Bản nháp lưu trong dữ liệu Electron cục bộ, không chứa token. Từ 1.4.1, mục lỗi/chưa chạy giữ bản nháp để kiểm tra và chạy lại; mục đã lưu/xác minh hoặc chỉ chờ ghi Notion được loại khỏi bản nháp. Thao tác chưa xác minh vẫn phải quét lại shop trước khi sửa tiếp.
5. Lịch hoàn huỷ đợi toàn bộ lượt sửa kết thúc/dừng rồi chạy ngay nếu đã đến hạn. Profile vẫn mở. Nếu Shopee đã lưu nhưng Notion lỗi, dùng **Đồng bộ lại**, không chạy lại lệnh sửa Shopee.

Kiểm thử giao diện hàng loạt: `node tests/product-batch-ui.cjs` (dữ liệu giả, không sửa shop thật).

### Sửa giá/kho với dữ liệu Shopee mới nhất (1.4.1)

- Giá trị nhập là **giá/tồn kho tuyệt đối muốn đặt**, không phải cộng/trừ vào số cũ. Số đang hiển thị trong app/Notion là số ở lần đọc trước. Ví dụ app còn 95, Shopee đã giảm về 88: nhập 0 và lưu sẽ đặt kho về 0 sau khi xác minh đúng sản phẩm và hộp sửa khớp số vừa đọc.
- Sửa từng cái và hàng loạt đều đọc mới từng sản phẩm trước khi thao tác, không buộc quét lại toàn bộ shop chỉ vì số trên Notion đã cũ. Nhập số trùng số cũ vẫn là một yêu cầu đặt số đó; nếu Shopee đã đúng số muốn đặt thì chỉ xác minh, không bấm lưu lại.
- Nhật ký giữ `requestedExpected` (số ở lần đọc trước) và `expected` (số thực tế ngay trước khi lưu). Sau khi lưu, dữ liệu Shopee đọc lại được đồng bộ Notion; lỗi ghi Notion không gửi lại thao tác Shopee. Các khoá thao tác, lịch hoàn huỷ và cảnh báo DOM/CSS tiếp tục áp dụng.

### Theo dõi thay đổi giao diện Shopee (1.4.0)

- Khung **Theo dõi giao diện Shopee** luôn có trên app. Đỏ: cấu trúc hoặc CSS không còn phù hợp; vàng: chưa kiểm tra được do tải trang/đăng nhập/mạng; xanh: những thành phần đã kiểm tra đang khớp mẫu. Kết quả theo từng profile, module và bước chạy, có thời điểm kiểm tra.
- Tool dùng DOM thật và CSS đã render từ Playwright; không cần trình biên dịch HTML/CSS hoặc dịch vụ AI. Kiểm tra selector, sự hiện diện/ẩn của cột/nút/ô nhập, định dạng ID, nhãn vận chuyển và màu CSS; so sánh mẫu cấu trúc/style các thành phần quan trọng. Giá, tồn kho, tên hàng, mã đơn và số dòng thay đổi không được coi là đổi giao diện.
- Module hoàn huỷ kiểm tra khi cuộn từng phần trang, trước khi kết quả được nhận. Theo lịch hoàn huỷ, sau khi đối chiếu/gửi dữ liệu mới, tool kiểm tra thêm danh sách sản phẩm của profile. Module sản phẩm kiểm tra khi mở danh sách, quét từng trang, chọn 48/trang và trước khi gửi lệnh trong hộp sửa giá/kho. Hộp sửa chỉ được kiểm tra khi mở sử dụng; không có thao tác sửa thật trong nút **Kiểm tra giao diện**.
- Nếu kiểm tra không đạt, lượt quét/thao tác tương ứng dừng trước khi nhận dữ liệu hoặc gửi lệnh. Sửa hàng loạt sẽ dừng các mục chưa chạy khi nhận lỗi giao diện; không hoàn tác mục đã lưu. Nếu lỗi xảy ra sau khi gửi lệnh, vẫn giữ cơ chế chưa xác minh và không tự gửi lại. Các module/profile khác vẫn có lịch và kết quả riêng.
- **Kiểm tra giao diện** kiểm tra ngay hai danh sách của các profile đang bật, dùng cùng khoá trình duyệt với quét/sửa; không ghi dữ liệu đơn hay sản phẩm lên Notion. Lịch hoàn huỷ đến hạn chờ thao tác kiểm tra xong. Hộp sửa chưa từng mở không được khẳng định là đã kiểm tra.
- Mẫu và cảnh báo lưu ở `data/interface-monitor/state.json`; mỗi profile/bước giữ báo cáo JSON và ảnh cảnh báo gần nhất. Báo cáo chỉ chứa selector/metadata DOM và CSS được chọn, không chứa HTML gốc, cookie, script hay giá trị ô nhập. Ảnh được che ô nhập và chỉ lưu trên máy; có thể vẫn chứa thông tin đơn/sản phẩm hiển thị. Nếu không chụp được ảnh, báo cáo vẫn được lưu. Nút **Mở báo cáo / ảnh** mở vị trí báo cáo cảnh báo gần nhất.
- Mẫu đầu tiên chỉ được lưu khi các thành phần bắt buộc hợp lệ. Thiếu selector, cấu trúc ô nhập hoặc đổi nhóm màu vận chuyển không được bỏ qua bằng nút chấp nhận. Với thay đổi style còn đủ cấu trúc, có thể **Chấp nhận mẫu đã kiểm tra** sau khi xem báo cáo và xác nhận; mẫu phải vừa kiểm tra trong 5 phút. Đây không phải trình sửa luồng: cần cập nhật bộ đọc nếu Shopee thay selector. Khi giao diện khớp mẫu cũ trở lại, cảnh báo tương ứng tự hết.
- Phạm vi là các thành phần mà hai bộ quét sử dụng, không phải phát hiện mọi thay đổi của toàn website hoặc bảo đảm đúng ngữ nghĩa nghiệp vụ khi DOM vẫn giống nhau. Không gửi ảnh/token/dữ liệu ra AI bên ngoài. Kiểm thử: `node --test tests/interface-monitor.test.cjs` và `node tests/interface-ui.cjs`.

## Sản phẩm thay thế (1.5.0)

1. Vào **Sản phẩm thay thế**, bấm **Tải dữ liệu Notion**, chọn đúng shop và ID sản phẩm. **Đọc form Shopee** lấy các trường bắt buộc có dấu `*` từ trang cập nhật hiện tại.
2. **Tạo bài mẫu Notion** giữ thông tin thật của sản phẩm nguồn, tạo bài con và điền URL vào cột **Sản phẩm thay thế**. Sửa khối JSON trong bài này theo thông tin sản phẩm đã kiểm tra. `target` là danh tính nguồn; `product` là nội dung muốn cập nhật. Link thư mục Drive chỉ là nguồn tham khảo, `images` cần link từng file đúng sản phẩm hoặc link khối ảnh Notion.
3. **Chuẩn bị bản xem trước** đọc lại Notion/Shopee, kiểm tra các trường, tải và nén ảnh, hiển thị thông tin trước/sau cùng ảnh mới. Chỉ **Chạy cập nhật lên Shopee** mới xoá ảnh cũ trong form, tải ảnh mới và bấm Cập nhật. Bản xem trước có hiệu lực 10 phút; nếu dữ liệu Shopee đổi, cần chuẩn bị lại.

Ảnh xử lý tại máy bằng Sharp: JPEG dưới 1.900.000 byte, tối thiểu 500×500, giữ đầy đủ nội dung bằng padding, xoay EXIF và nền trắng. Ảnh lỗi/động/HTML hoặc quá giới hạn bị từ chối. Nén JPEG có thể giảm chi tiết; không bảo đảm giữ nguyên chất lượng. Bài mẫu đính kèm ảnh đã nén trên Notion, dùng link khối ảnh ổn định và lấy lại URL tải mới mỗi lượt, nên không phụ thuộc URL ký tạm thời.

Luồng giữ nguyên ID sản phẩm, ngành hàng và cấu trúc/Model ID phân loại. Sản phẩm không phân loại có thể đổi giá/kho qua bài mẫu; sản phẩm có nhiều phân loại dùng mục sửa giá/kho hiện có. Trường bắt buộc mới hoặc control chưa nhận diện sẽ dừng và báo giao diện. Tool không tự đồng ý điều khoản Shopee. Khi gửi lưu nhưng chưa xác minh được kết quả, journal đánh dấu **Chưa xác minh**, chặn gửi lại để tránh lặp thao tác.

Module dùng chung khoá trình duyệt với hoàn huỷ. Giữ nguyên giờ đã đặt; lượt hoàn huỷ đến hạn trong lúc thay sản phẩm sẽ chạy ngay khi thao tác kết thúc. Mở lại app không tự chạy bản xem trước. Profile, token mã hoá, bài đã liên kết và journal lưu trong thư mục dữ liệu local hiện có; bộ cài không mang dữ liệu đăng nhập.

## Studio sản phẩm thay thế (1.6.6)

Nút **Quét lại sản phẩm** ngay tại **Chọn sản phẩm nguồn** quét tất cả profile đang bật. Mục Shop hiển thị số sản phẩm của từng shop; shop đã liên kết nhưng chưa có dữ liệu vẫn có trong danh sách. Menu **Notion** chứa **Mở bảng Notion** và **Tải bài đã có từ Notion**. Nút tải này phục hồi bài thay thế đã lưu, không quét sản phẩm Shopee.

1. Trong **Sản phẩm thay thế → Viết & gửi bài**, lọc shop/tên hoặc ID rồi tích đúng bài Shopee cần sửa. Mỗi bài nguồn đã là một insight: tool mở một bản nháp theo shop + ID sản phẩm, chọn lại lấy đúng bài cũ, không nhân bản. Nhập **tên sản phẩm mới**, prompt và giá; bấm **Viết bài bằng Gemini** để gọi API và hiện nội dung ngay trong form. Viết bài không mở profile Shopee và không chặn lịch hoàn huỷ. Nhân viên đọc, chỉnh sửa rồi bấm **Đẩy bài lên Notion**; nút này lưu bản chỉnh sửa và xác nhận nội dung trong cùng thao tác, sau đó chuyển sang làm ảnh. Không còn nút duyệt riêng. Bài ở bước này chưa có ảnh. Bảng riêng **Sản phẩm thay thế** nằm dưới trang sản phẩm online, không xoá bảng sản phẩm nguồn. Các bản nháp cũ vẫn giữ nguyên.
2. Luồng dự phòng thủ công: trong **Tạo & gắn ảnh**, chọn bài đã đẩy và chuẩn bị 5 prompt từ nội dung Notion mới nhất. Sao chép lần lượt từng prompt, mở **Chrome thường**, đính kèm ảnh mẫu đúng sản phẩm và tạo/tải 5 ảnh thủ công. Chọn từng file vào vị trí 1–5, xem ảnh rồi bấm **Nhập 5 ảnh & lưu local**. Tool kiểm tra đủ 5 ảnh khác nhau, nội dung bài chưa đổi, nén JPEG dưới 1,9 MB và lưu theo shop/tên sản phẩm trong Drive local. Khi nhập ảnh, tool đọc form nguồn nếu chưa có để giữ đúng các trường bắt buộc trước khi cập nhật Shopee. Hai sản phẩm trùng tên dùng hậu tố ID; thư mục và ảnh cũ không bị ghi đè. Bấm **Gắn 5 ảnh vào bài Notion** sau khi xem ảnh. Notion nhận ảnh đã nén và URL khối ảnh ổn định; đường dẫn local được lưu dạng chữ. Link Drive là thư mục gốc, không phải link từng file. Chrome Debug vẫn có trong mục tuỳ chọn; kết nối CDP không bảo đảm vượt xác minh Cloudflare.
3. Trong **Cập nhật Shopee**, chọn bài đủ nội dung/ảnh và chuẩn bị bản xem trước. Kiểm tra rồi bấm **Chạy cập nhật lên Shopee** ngay trong bước 3. Studio giữ tồn kho mới đọc được để không đưa lượng hàng cũ trở lại sau khi đã bán. Giao diện chọn nguồn lần hai, đọc form, tạo mẫu, nhập link và lịch sử cũ đã bỏ; dữ liệu và journal cũ vẫn giữ nguyên.

Ô prompt có thư viện ba mẫu bán hàng theo bố cục đã cung cấp: mô tả, thành phần, công dụng hỗ trợ, đối tượng, cách dùng, lưu ý, hashtag. Chọn mẫu rồi **Áp dụng** để điền vào bản nháp; không tự chạy AI. Có **Thêm mẫu**, **Sửa mẫu**, **Xoá mẫu**. Mẫu được lưu local tại `data/replacement-studio/prompts.json`, sửa/xoá giữ qua cập nhật và restart. Mỗi mẫu yêu cầu dùng dữ kiện của đúng sản phẩm nguồn, không lấy thành phần Oximin làm dữ kiện cho sản phẩm khác.

Gemini nhận prompt và tên sản phẩm mới; tên sản phẩm nguồn chỉ dùng để liên kết bài thay thế, không gửi dữ kiện của sản phẩm cũ vào yêu cầu viết. Lỗi tạm thời HTTP 500/502/503/504 được thử lại tối đa hai lần trong giới hạn 60 giây; thông báo phân biệt lỗi dịch vụ với lỗi xác thực và quota. Tool không tự đổi mô hình hoặc tự gửi bài lên Notion khi API viết thành công.

**Kiểm tra kết nối** thử cùng định dạng JSON, schema và kiểm tra nội dung như chức năng viết bài; một câu trả lời chữ "OK" không đủ để báo thành công. Phần kết nối hiển thị model và thời điểm gọi gần nhất, chuyển đỏ khi lượt kiểm tra/viết lỗi, thay cho kết quả thành công cũ. HTTP 503 `UNAVAILABLE` kèm thông báo `high demand` nghĩa là model đang quá tải ở thời điểm gọi; lần kiểm tra trước đó thành công không bảo đảm lần viết tiếp theo thành công.

Mở **Kết nối Gemini, ChatGPT & thư mục ảnh** để nhập API key và kiểm tra kết nối. Key lưu mã hoá bằng tài khoản Windows hiện tại. Model chỉ được dùng nếu API ListModels trả về; tool không giả định `gemini-3.8-flash` tồn tại. Có thể đọc bài tham khảo từ link công khai hoặc dán cấu trúc vào ô tham khảo khi Shopee yêu cầu xác minh. Dữ kiện bài mẫu không được dùng thay dữ kiện sản phẩm nguồn.

API key được xem là token opaque: hỗ trợ cả định dạng có dấu chấm như `AQ.…`, chỉ kiểm tra độ dài và an toàn header trước khi gửi tới Google. Khoảng trắng ở đầu/cuối khi sao chép được bỏ; ký tự điều khiển bên trong bị chặn. Nút kiểm tra kết nối phân biệt Google từ chối khóa/quyền với HTTP 429 do hạn mức. Key không xuất hiện trong snapshot hoặc thông báo lỗi.

Drive local mặc định: `G:\My Drive\Hình ảnh Shopee\Sản phẩm thay thế`. Cài Google Drive Desktop và chọn thư mục đồng bộ phù hợp khi chuyển máy. Tool kiểm tra file local, không xác nhận đồng bộ cloud và không cần Drive API. Profile ChatGPT riêng tại `data/chatgpt-studio/profile`, cổng Debug mặc định 9222; đăng nhập trong cửa sổ đó rồi kiểm tra kết nối. Xác minh/login phải được hoàn tất thủ công nếu nhà cung cấp yêu cầu; không bảo đảm vượt kiểm tra bot.

Bản nháp, bước đã hoàn tất, link Notion, ảnh và journal lưu trong `data/replacement-studio` và `data/chatgpt-studio`; cập nhật bản cài giữ nguyên các thư mục này. Mỗi lượt ghi Notion đối chiếu Mã tác vụ/shop/ID để tránh trùng. Lượt ChatGPT đã gửi hoặc lượt lưu Shopee chưa xác minh không tự chạy lại. ChatGPT dùng trình duyệt riêng nên hoàn huỷ vẫn chạy theo lịch; thao tác Shopee dùng chung khoá và lượt đến hạn được chạy sau khi thao tác hiện tại kết thúc.

Cột **Cần thay thế** trên bảng sản phẩm nguồn để trống khi chưa có link; có link bài mới là **Chưa thay thế**. Chỉ sau khi lưu và đọc lại Shopee đúng nội dung/ảnh/giá/kho mới ghi **Đã thay thế**. Gắn lại cùng link giữ trạng thái đã xong; đổi sang bài khác trở về chưa thay thế. Nếu Notion lỗi sau khi Shopee đã xác minh, bấm **Đồng bộ lại** ở Sản phẩm để chỉ ghi lại Notion, không chạy Shopee lần nữa.

## Luồng tiện ích cũ (1.6.9, giữ để tương thích dữ liệu)

1. Cài bản mới, mở **Sản phẩm thay thế**. Cấu hình Studio nằm trên cùng; Chrome Debug được ẩn.
2. Bấm **Mở thư mục tiện ích**. Trong Chrome thường vào `chrome://extensions`, bật Chế độ nhà phát triển, chọn **Tải tiện ích đã giải nén / Load unpacked** và chọn thư mục vừa mở. Chỉ cài một lần; sau cập nhật dùng nút tải lại tiện ích.
3. Mở ChatGPT và đăng nhập bằng Chrome thường. Bấm **Ghép nối Chrome** trong tool, mở tiện ích, chọn đúng tab ChatGPT rồi nhập mã dùng một lần, không hết hạn theo thời gian. Tool và tiện ích nhớ kết nối trên máy: sau khi mở lại Chrome, chọn tab và bấm **Kết nối lại tab này**, không cần nhập mã. Khi cập nhật từ 1.6.7, tải lại tiện ích một lần và ghép lại để lưu kết nối mới. **Ngắt kết nối** thu hồi khóa đã lưu trên tool; không xóa lịch sử gửi ảnh.
4. Ở bước 2 chọn bài Notion, **Chuẩn bị 5 prompt**, chọn ảnh mẫu đúng sản phẩm mới rồi bấm **Tạo lần lượt 5 ảnh**. Mỗi lượt đều kèm ảnh mẫu: gửi prompt 1, chờ đúng ảnh hoàn chỉnh, nén và xác minh lưu ảnh 1 xong mới gửi prompt 2; tiếp tục tới prompt 5. Bước chuẩn bị form Shopee dùng khoá trình duyệt ngắn; thời gian chờ tạo ảnh không giữ khoá Shopee, lịch hoàn huỷ vẫn hoạt động.
5. Ảnh hiển thị ngay sau từng lần lưu, nén JPEG dưới 1,9 MB và lưu tại `<Drive local>/<shop>/<tên sản phẩm mới>/1.jpg…5.jpg`. Tên thư mục trùng thuộc sản phẩm khác được thêm ID. Drive Desktop tự đồng bộ; tool chỉ xác minh file local.
6. Đủ 5 ảnh và xác minh xong mới hiện nút **Gắn 5 ảnh vào bài Notion**. Nhân viên xem rồi bấm; tool không tự đính kèm hoặc cập nhật Shopee. Nhập ảnh thủ công nằm trong mục dự phòng.

Tiện ích 1.0.2 tự mở nút **+** và mục thêm ảnh khi ChatGPT chỉ tạo input upload sau khi mở menu. Nó chỉ chọn ô tải ảnh thuộc composer/menu vừa mở, chờ ảnh tải xong rồi mới gửi; ô tải mơ hồ, bản nháp hiện có hoặc trang xác minh đều làm tool dừng trước gửi.

Nút **Xoá bản nháp** nằm ngay dưới **Bài đang sửa** ở bước 1. Chỉ xoá bài local chưa đẩy Notion, chưa có lượt gửi cần đối chiếu hoặc dữ liệu ảnh. Bản nháp đã xoá được bỏ khỏi danh sách sau cả khi mở lại app; bài khác, link Notion, ảnh, cấu hình và lịch sử gửi được giữ. App ghi dấu xoá trong state local, không xoá file ảnh hoặc gọi xoá Notion.

Tiện ích chỉ dùng ChatGPT và kết nối `127.0.0.1:9223`, ghép theo tab/document/lượt gửi; không đọc cookie, không dùng Debug, không giải xác minh. Tool mã hóa khóa kết nối Windows tại `data/chrome-pairing.enc`; tiện ích giữ khóa trong storage chỉ dành cho background/popup, không chia sẻ với trang web. Mã chưa dùng mất hiệu lực khi đóng tool, tạo mã mới hoặc ngắt kết nối. Nếu giao diện, tab, bài Notion hoặc kết nối thay đổi, tool dừng và giữ ảnh đã lưu. Lượt đã gửi hoặc chưa xác minh không tự gửi lại, kể cả sau khởi động lại. Bộ ảnh từng phần được giữ để kiểm tra; nhập thủ công chỉ dùng được khi chưa có ảnh Chrome đã lưu. Log nằm ở Nhật ký bài viết & ảnh; lịch sử gửi riêng trong `data/chrome-image-studio`.

Kiểm tra tự động dùng fixture ChatGPT/Notion, không chứng minh nhà cung cấp chấp nhận hoặc tài khoản thật tạo ảnh thành công. Cần chạy thực tế sau khi cài và ghép tiện ích. Giới hạn/quyền tạo ảnh của tài khoản ChatGPT vẫn áp dụng.

## Bộ cài Windows và dữ liệu lâu dài (1.6.9)

- Cài file Shopee-Returns-Setup-1.6.9-x64.exe. Không cần Node.js; cần Chrome hoặc Microsoft Edge để quét Shopee và Chrome để tạo ảnh ChatGPT.
- Bản cài lưu toàn bộ dữ liệu dưới %APPDATA%\ShopeeReturns: data/state.json, data/credentials.enc, data/profiles và electron (khoá mã hoá/trạng thái Electron). Không lưu dữ liệu trong thư mục chương trình.
- Cài bản mới đè lên bản cũ, cùng tài khoản Windows, giữ appId và đường dẫn dữ liệu. Đóng app hoàn toàn qua khay hệ thống trước khi cập nhật. Không xoá %APPDATA%\ShopeeReturns. Sao lưu cả thư mục này khi app và browser đã đóng. Chuyển sang máy/tài khoản khác cần nhập lại token và đăng nhập Shopee.
- Cài đặt → Nhập file cấu hình: JSON chỉ nhận các trường notionToken, telegramToken, chatId, notionPageId, notionDatabaseId, sheetUrl, intervalMinutes, autoScan, notionEnabled, telegramEnabled, startWithWindows, keepAwake, closeToTray. Token lưu mã hoá bằng safeStorage tại máy nhận. File nhập chứa token dạng đọc được, cất riêng và không đưa lên repo.
- Bật autoScan và keepAwake để giữ app hoạt động khi màn hình tắt; closeToTray để nút X chỉ ẩn cửa sổ; startWithWindows để mở lại sau khi đăng nhập Windows. App không phải Windows Service và không quét khi máy tắt, ngủ thủ công, đăng xuất hoặc chưa đăng nhập Windows.
- Chỉ chạy một máy quét vào cùng bảng Notion tại một thời điểm. Chưa có khoá phân tán giữa các bản cài.
- Bộ cài chưa có chữ ký số; Windows có thể hiển thị cảnh báo nhà phát hành chưa xác định. Không có cập nhật tự động: chạy bộ cài phiên bản mới để cập nhật.


## Chrome riêng và ảnh PNG (1.6.10)

1. Cấu hình Studio → **Mở Chrome riêng** → đăng nhập ChatGPT → **Kiểm tra đăng nhập**. Profile độc lập nằm trong dữ liệu app tại `chatgpt-studio/profile-cdp`, giữ đăng nhập qua cập nhật. Chrome dùng cổng loopback tự chọn để không xung đột với MCP Shopee; không cần tiện ích hay mã ghép nối. Endpoint phải khớp file `DevToolsActivePort` của chính profile trước khi điều khiển.
2. Chọn bài đã đẩy Notion, chuẩn bị 5 prompt, chọn ảnh mẫu rồi bấm **Tạo lần lượt 5 ảnh**. Mỗi prompt đính kèm lại ảnh mẫu đã chọn. Tool chờ kết quả hoàn chỉnh của đúng lượt, tải file gốc, chuyển thành PNG thật và xác minh lưu xong trước khi gửi prompt kế tiếp.
3. Lưu `1.png`–`5.png` tại `G:\My Drive\Hình ảnh Shopee\Sản phẩm thay thế\<shop>\<tên sản phẩm mới>`. Khi tên trùng thuộc sản phẩm khác, thêm ID để giữ ảnh cũ. Ảnh hiện trên tool sau mỗi lần lưu; chỉ khi đủ 5 ảnh mới hiện nút gắn Notion. Bản JPEG dưới 1,9 MB dùng để đính kèm Notion/Shopee được giữ riêng trong dữ liệu app. PNG lưu Drive có thể lớn hơn 2 MB.
4. Xoá bản nháp xử lý ngay trên máy, không mở hộp thoại hệ thống. Chỉ bài chưa gửi Notion và chưa có lịch sử tạo ảnh mới được xoá. Có thể chọn ngay sản phẩm tiếp theo; bản nháp khác vẫn giữ chỉnh sửa chưa lưu.

Chrome riêng không bảo đảm vượt yêu cầu đăng nhập/xác minh của ChatGPT. Lượt đã gửi nhưng chưa xác minh vẫn bị khoá, không tự gửi lại hoặc xoá lịch sử. Module tạo ảnh dùng trình duyệt riêng; khoá Shopee chỉ giữ ngắn lúc đọc form, lịch hoàn/huỷ tiếp tục chạy trong lúc chờ ảnh. Drive cloud do Drive Desktop đồng bộ, tool chỉ xác minh local.
