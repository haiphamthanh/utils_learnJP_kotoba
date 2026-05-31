# Learn JP Wordlist

Project học từ vựng tiếng Nhật chạy bằng local server `Node.js + Express + Yarn`, dữ liệu nguồn lấy từ các file CSV trong `word-list/`.

## Cấu trúc

- `src/`: mã nguồn giao diện HTML/CSS/JS
- `scripts/build-wordlist.mjs`: builder Node.js sinh dữ liệu tĩnh từ CSV
- `server.js`: local server Express để phục vụ UI và API
- `word-list/`: dữ liệu CSV gốc
- `dist/`: output để deploy hoặc mở qua static server

## Cài dependencies

```bash
yarn install
```

## Build lại website

```bash
yarn build
```

Sau khi build, dữ liệu từ `word-list/*.csv` sẽ được chuyển thành:

- `dist/data/words.json`
- `dist/index.html`
- `dist/styles.css`
- `dist/app.js`

## Chạy local

Chạy local server:

```bash
./start.sh
```

Sau đó truy cập `http://localhost:8000`.

Để dừng server:

```bash
./stop.sh
```

API local:

- `GET /api/health`
- `GET /api/words`
- `GET /api/examples/:expression`
- `POST /api/examples`
- `PUT /api/examples/:expression`
- `DELETE /api/examples/:expression`
- `POST /api/actions`
- `GET /api/stats?range=day|week|month`
- `POST /api/archive`

## MySQL examples

Server sẽ tự tạo các bảng và view thống kê khi có cấu hình MySQL:

- `vocabulary`: lưu từ vựng với primary key là `expression`
- `vocabulary_examples`: lưu tối đa 3 example cho mỗi `expression`
- `vocabulary_action_logs`: lưu các action `view`, `learned`, `unlearned`, `favorite`, `unfavorite` kèm thời gian và metadata
- `vocabulary_action_stats_daily`: tổng hợp log theo ngày
- `vocabulary_action_stats_weekly`: tổng hợp log theo tuần
- `vocabulary_action_stats_monthly`: tổng hợp log theo tháng

Archive lịch sử học được lưu tại `archives/yyyymmdd.zip`. File zip chứa
`archive.json` với khoảng thời gian học, snapshot đầy đủ từ browser, toàn bộ
local action logs, word snapshot, action summary và toàn bộ MySQL logs kèm thông
tin từ vựng nếu có.

Tạo database trước:

```sql
CREATE DATABASE learn_jp_wordlist
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Sau đó set env theo `.env.example` trước khi chạy `./start.sh`.

Ví dụ thêm example:

```bash
curl -X POST http://127.0.0.1:8000/api/examples \
  -H "Content-Type: application/json" \
  -d '{
    "expression": "語彙",
    "examples": [
      {"sentence": "語彙を毎日少しずつ増やします。"},
      {"sentence": "この語彙はニュースでよく見ます。"},
      {"sentence": "語彙の使い方を例文で確認します。"}
    ]
  }'
```

## Menu quản lý port

Chạy menu shell:

```bash
./port_menu.sh
```

Menu hỗ trợ:

- xem port hiện tại đang được process nào sử dụng
- dừng process đang listen trên một port cụ thể

## Cập nhật word list

1. Sửa hoặc thêm file CSV trong `word-list/`
2. Chạy lại `yarn build`
3. Nếu đang chạy local server, restart bằng `./stop.sh` rồi `./start.sh`
4. Deploy thư mục `dist/` hoặc tích hợp tiếp qua Express API

## Deploy lên real host

Ứng dụng này không nên deploy như static-only site vì các chức năng examples,
stats, action logs, archive/reset cần Node.js + Express. Chọn VPS hoặc hosting
có Node.js, MySQL và cho phép chạy process nền.

### Chuẩn bị host

Yêu cầu tối thiểu:

- Ubuntu VPS hoặc server Linux tương đương
- Node.js 20+ hoặc 22+
- Yarn 1.x
- MySQL 8 hoặc MariaDB tương thích
- Nginx làm reverse proxy
- Domain trỏ DNS `A record` về IP server

### Cấu hình production

Tạo `.env` trên server từ `.env.example`:

```bash
cp .env.example .env
```

Ví dụ `.env` production:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=8000
TRUST_PROXY=true

BASIC_AUTH_USER=your_admin_user
BASIC_AUTH_PASSWORD=your_long_random_password

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=learn_jp_user
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=learn_jp_wordlist
```

`BASIC_AUTH_USER` và `BASIC_AUTH_PASSWORD` rất quan trọng khi public, vì app có
API ghi dữ liệu và archive/reset lịch sử học. Khi 2 giá trị này được set, toàn
bộ app/API sẽ yêu cầu đăng nhập, ngoại trừ `/api/health`.

### Tạo database

```sql
CREATE DATABASE learn_jp_wordlist
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'learn_jp_user'@'localhost' IDENTIFIED BY 'your_mysql_password';
GRANT ALL PRIVILEGES ON learn_jp_wordlist.* TO 'learn_jp_user'@'localhost';
FLUSH PRIVILEGES;
```

Server sẽ tự tạo bảng và view khi khởi động.

### Deploy code

Trên server:

```bash
cd /var/www
git clone <your-repo-url> learn-jp-wordlist
cd learn-jp-wordlist
yarn install --production
yarn build
```

Nếu bạn chưa dùng Git, có thể upload toàn bộ project lên `/var/www/learn-jp-wordlist`.
Không upload `.env` lên Git public.

### Chạy bằng PM2

```bash
yarn global add pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

PM2 sẽ chạy `server.js` ở `127.0.0.1:8000`. Nginx sẽ public ra domain.

### Hoặc chạy bằng systemd

Copy file mẫu:

```bash
sudo cp deploy/learn-jp-wordlist.service /etc/systemd/system/learn-jp-wordlist.service
sudo nano /etc/systemd/system/learn-jp-wordlist.service
```

Sửa `WorkingDirectory` và `EnvironmentFile` đúng path thật. Sau đó:

```bash
sudo systemctl daemon-reload
sudo systemctl enable learn-jp-wordlist
sudo systemctl start learn-jp-wordlist
sudo systemctl status learn-jp-wordlist
```

### Cấu hình Nginx

Copy file mẫu:

```bash
sudo cp deploy/nginx.learn-jp-wordlist.conf /etc/nginx/sites-available/learn-jp-wordlist
sudo nano /etc/nginx/sites-available/learn-jp-wordlist
```

Thay `example.com` bằng domain thật. Sau đó:

```bash
sudo ln -s /etc/nginx/sites-available/learn-jp-wordlist /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### HTTPS

Cài Certbot và cấp SSL:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

Sau đó truy cập `https://example.com`.

### Checklist trước khi public

- DNS domain đã trỏ về IP server
- `.env` có `NODE_ENV=production`
- `.env` có `BASIC_AUTH_USER` và `BASIC_AUTH_PASSWORD`
- MySQL user không dùng `root`
- `yarn build` đã chạy thành công
- Nginx có `client_max_body_size 25m` để archive không lỗi payload lớn
- `archives/*.zip`, `.env`, `.server.log`, `node_modules/`, `dist/` không commit lên Git
- Test `GET /api/health`
- Test đăng nhập Basic Auth trên domain thật

### Cập nhật production sau này

```bash
cd /var/www/learn-jp-wordlist
git pull
yarn install --production
yarn build
pm2 restart learn-jp-wordlist
```

Nếu dùng systemd:

```bash
sudo systemctl restart learn-jp-wordlist
```
