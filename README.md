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
