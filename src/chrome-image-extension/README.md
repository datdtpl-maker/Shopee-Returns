# Tiện ích Chrome thường cho Shopee Returns

1. Trong tool, mở **Sản phẩm thay thế → Cấu hình → Tiện ích Chrome** để lấy đường dẫn tiện ích và mã ghép nối.
2. Mở `chrome://extensions`, bật **Chế độ dành cho nhà phát triển**, chọn **Tải tiện ích đã giải nén**, chọn thư mục này.
3. Mở ChatGPT bằng Chrome thường, đăng nhập thủ công. Mở tiện ích, chọn tab ChatGPT và nhập mã ghép nối.
4. Trở lại tool, chọn bài, chuẩn bị 5 prompt, chọn ảnh mẫu rồi bấm nút tạo ảnh.

Giữ đúng tab đang tạo ảnh mở. Tool nhận file ảnh gốc sau khi đúng lượt trả lời đã hoàn tất, lưu và nén ở thư mục shop/sản phẩm. Tool không tự gửi lại lượt chưa xác minh.

Nếu ChatGPT chỉ tạo ô tải file sau khi mở nút **+**, tiện ích tự mở đúng menu của ô nhập để chọn ảnh mẫu. Khi có nhiều ô tải ảnh không phân biệt được, tiện ích dừng trước khi tải/gửi và giữ nguyên bản nháp.

Tiện ích nhớ ghép nối sau khi mở lại tool hoặc Chrome. Mã lần đầu dùng một lần, không hết hạn theo thời gian; mã cũ mất hiệu lực khi tạo mã mới, đóng tool hoặc ngắt kết nối. Khi mở lại Chrome, chọn đúng tab ChatGPT trong tiện ích rồi bấm **Kết nối lại tab này**, không cần nhập mã nữa. Reload tab chỉ tự kết nối lại khi không có lượt tạo đang chạy/chưa xác minh. Nếu có lượt chưa xác minh, tiện ích dừng để tránh tạo ảnh hoặc gửi prompt trùng. Nút **Ngắt kết nối** trong tool thu hồi kết nối đã lưu; ghép lại mới dùng được.

Tiện ích dùng kết nối local `127.0.0.1:9223`, không dùng Chrome Debug, không đọc cookie, không giải hoặc tự bấm xác minh bảo mật. Đăng nhập/xác minh trong Chrome do người dùng thực hiện. Nếu ChatGPT thay đổi giao diện và các điều kiện xác minh không còn khớp, tool dừng và hiện lỗi để kiểm tra.
