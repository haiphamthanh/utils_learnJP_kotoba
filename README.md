# Learn JP Wordlist

Static website học từ vựng tiếng Nhật từ các file CSV trong `word-list/`.

## Cấu trúc

- `src/`: mã nguồn HTML/CSS/JS của website
- `word-list/`: dữ liệu CSV gốc
- `build.py`: builder sinh site tĩnh
- `dist/`: output để deploy hoặc mở qua static server

## Build lại website

```bash
python3 build.py
```

Sau khi build, dữ liệu từ `word-list/*.csv` sẽ được chuyển thành:

- `dist/data/words.json`
- `dist/index.html`
- `dist/styles.css`
- `dist/app.js`

## Chạy local

Nên mở bằng static server thay vì `file://` để `fetch()` đọc được JSON:

```bash
./start.sh
```

Sau đó truy cập `http://localhost:8000`.

Để dừng server:

```bash
./stop.sh
```

## Cập nhật word list

1. Sửa hoặc thêm file CSV trong `word-list/`
2. Chạy lại `python3 build.py`
3. Deploy thư mục `dist/`
