# 維護與功能邊界

`launch-wallpaper.ps1` → 原版啟用／冷啟動動畫 → 接入服務 → 介面核對 → 靜態圖片 → 動態首幀。原版視窗不必等桌布。標題列及側欄由受控輔助程序提供，不修改官方安裝包。

| 區域 | 主要程式 | 保留行為 |
| --- | --- | --- |
| 啟動 | scripts/launch-wallpaper.ps1、ensure-codex-visible.ps1 | 原生啟用、單次冷啟動、工作列分組、短期提示回退 |
| 動畫 | src/boot-animation、scripts/boot-*.ps1 | 全螢幕、Esc、預載、完成最大化、隱藏按鈕 |
| 接入 | src/companion/supervisor.cjs、runtime-runner.cjs | 身分檢查、有限重試、最小化暫停、失敗保留原版 |
| 控制 | src/companion、plugins/codex-wallpaper-control | 五分頁、可見狀態、MCP、設定保存與遷移 |
| 桌布 | src/wallpaper | 圖片、影片、Scene、六區材質、播放清單、預設、省電 |
| 引擎 | src/renderer、src/scene-renderer、src/frame-stream.cjs | 隔離 Edge、WebWallGL、完整效果、原尺寸、最新影格、有界快取 |

## 2026-11-09 精簡

- 共用 `src/json-lines.cjs` 處理三種背景程序輸出，保留各自的生命週期與重啟上限。限制每筆資料長度；單一 pipe chunk 含多筆正常訊息時不誤判溢位。
- 標題排序移至素材掃描完成時；刷新採 Set 查詢收藏與隱藏，依收藏優先分組。保留穩定 ID、重新掃描及即時設定更新，每次回傳獨立卡片。
- 使用者預設直接讀取自己的文件，列出 N 份預設的舊色盤讀取由 N+1 次降至一次。不加入會掩蓋外部檔案修改的時間快取。
- 外觀頁重用單次 snapshot，移除冗餘條件。畫質、FPS、特效不降低。
- 來源與安裝包共用發布清單，包含動畫、原生元件、WebView2、控制插件及測試，排除日誌與私人資料。建置清理只允許專案 dist／.state 子目錄，拒絕符號連結及來源目錄。
- 新增整合安裝腳本，組合既有安裝器與原版圖示捷徑。舊管理器及實驗性原版掛載工具仍保留，不作為預設流程。

這批改動減少側欄及程序訊息處理的重複工作，沒有宣稱 WebGL 本身變快，也沒有移除身分驗證、介面契約或失敗保護。完整冷啟動與長時間 GPU 負載仍須實機量測。
