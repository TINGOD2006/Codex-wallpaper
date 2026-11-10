# 2026-11-10 發布驗證

- 乾淨來源重新 npm ci、264 項 Node 回歸全部通過，build:companion 成功。
- Windows entry-hint、entry-feedback、entry-watch、launch-concurrency、launch-fail-open、native-activation、boot-visibility 七組 fixture 通過。
- 1,001 張合成素材卡片、500 收藏及 300 隱藏項目，100 次刷新、五輪中位數：原方法 1,445.03 ms，新方法 19.41 ms。兩種方法輸出深度比較一致。僅量測卡片建立／排序，排除素材掃描、宿主啟動與動態渲染；不是整體 CPU 或 FPS 提升的證據。
- 原版 Codex 未被關閉或重啟。七個執行元件已經雜湊核對、備份及部署，使用者設定位元組一致；新程式於下次完整啟動載入。
- 來源包含完整既有功能，排除本機 session、日誌、帳號、工坊內容與個人路徑。第三方原始檔及授權保留原位元組。
- 本次沒有重跑實體 UI 的完整冷啟動、70 秒最小化或長時間 GPU 壓力測試；先前的實機記錄另見 VALIDATION.md。
