# Codex Wallpaper

Windows Codex／ChatGPT 模式的全視窗桌布擴充。保留原生版面，從 Codex 整合捷徑啟動，在最小化按鈕左側提供 **◈ Wallpaper** 五分頁側欄。日常使用不需要另外開管理器。

這是非官方的本機擴充，程式與資料存放在宿主安裝包之外，不修改官方程式檔。需要透過整合捷徑冷啟動以建立接入端點；其他原版入口不保證自動載入。宿主更新後重新核對程序身分及介面，不相容時保留原版並回報錯誤。

## 功能

- 圖片、影片、Wallpaper Engine Scene 本機素材庫、搜尋、收藏、隱藏及匯入。Scene 由 WebWallGL 即時渲染，並非啟動 Wallpaper Engine 官方引擎；並非所有工坊特效都相容。
- 背景涵蓋聊天、左欄、輸入框、頂欄、右側面板與浮層，六區材質獨立調整，預設保留原生配色。
- 五分頁：桌布庫、畫面、材質、播放、預設。支援填充、焦點、平移、縮放、閱讀遮罩、預設匯入／匯出及播放清單。
- 完整效果與原尺寸設定，15／30／60 FPS、場景即時渲染開關；省電模式停止動態引擎並顯示最後一幀或預覽圖。
- 啟動先顯示同桌布的靜態畫面，再預載及替換動態首幀；共用隔離 Edge、合併準備工作、最多 512 MiB 貼圖快取。
- 最小化暫停，還原經原生啟用流程恢復；既有視窗叫回不重播動畫或重複開啟桌布。
- 冷啟動全螢幕 Dragon 動畫，期間隱藏 Wallpaper 按鈕；正常播完最大化 Codex，Esc 可略過。
- 官方工作列圖示與分組、啟動互斥、短期宿主提示、有限重試及可見錯誤；桌布失敗不阻擋原版啟動。
- 附本機 MCP 控制插件，可查狀態、調整外觀、重試及產生去識別診斷。舊管理器及隔離測試入口仍保留。

## 安裝

需要 Windows 10/11、Microsoft Store Codex、Node.js **24+**、PowerShell **7.4+**、Microsoft Edge 與 WebView2 Runtime。安裝 MCP 控制插件另需 Codex CLI；加 `-SkipPlugin` 可只安裝桌布與原生側欄。

在 PowerShell 7 執行：

```powershell
git clone https://github.com/TINGOD2006/Codex-wallpaper.git
cd Codex-wallpaper
npm ci
npm test
npm run build:companion
pwsh -NoProfile -File scripts/install-integrated.ps1
```

安裝會建立桌面及開始功能表的 **Codex** 整合捷徑，保留設定；不開管理器視窗，也不自動結束原版 Codex。若 Codex 已由其他入口運行，請先儲存工作並正常完全退出，再從整合捷徑開啟。

首次設定工作列時，釘選 `%USERPROFILE%\.codex-wallpaper\data\entry-assets\Codex.lnk`；既有原版釘選可能仍指向官方入口。安裝器不直接修改 Windows 釘選資料。已釘選整合入口的使用者不需再次釘選。

建置後的 `dist/companion` 可交付，使用其中 `安裝CodexWallpaper.cmd` 安裝。原始碼中的 `安裝獨立桌布插件.cmd` 是保留的舊管理器流程；整合安裝請用上面的指令。

## 使用與資料

點 **◈ Wallpaper** 選擇桌布並啟用。省電模式位於「播放」，保留 FPS、解析度、音量與即時渲染偏好，關閉後恢復完整效果。

安裝根目錄 `%USERPROFILE%\.codex-wallpaper` 中，`app` 放程式、`data` 放設定及素材、`runtime` 放暫時連線資料、`logs` 放診斷。更新不覆寫設定，原捷徑及遷移資料會備份。請勿上傳這些私人目錄。

`data/boot-animation.json` 中的 `{"enabled":false}` 可停用動畫。正常播完會 Windows 最大化，保留標題列及工作列；Esc、媒體失敗及逾時不改變原視窗尺寸。

解除安裝：

```powershell
pwsh -NoProfile -File "$env:USERPROFILE/.codex-wallpaper/app/scripts/uninstall-companion.ps1"
```

預設保留 `data` 與工坊來源。解除安裝前可使用已安裝的 `install-codex-user-shortcuts.ps1 -Restore` 還原未被另外修改的桌面／開始功能表捷徑；工作列釘選由使用者自行調整。

## 排錯

| 狀態 | 處理 |
| --- | --- |
| `HOST_NEEDS_MANAGED_LAUNCH` | 正常退出後改從整合捷徑冷啟動。 |
| `HOST_ENDPOINT_PENDING` | 背景等候接入最多 90 秒，不阻擋原版。 |
| `HOST_ENDPOINT_TIMEOUT` | 已停止自動重試；從側欄重試並查看診斷。 |
| `ADAPTER_LAYOUT_MISMATCH` | 必要介面結構不同，保持原版並更新適配器。 |
| `RENDERER_FAILED` | 保留靜態畫面，重試或更換桌布。 |
| `RUNTIME_MISSING` | 檢查 Node、PowerShell、Edge／WebView2。 |

按鈕出現不代表背景已接通，以側欄實際套用狀態為準。獨立 ChatGPT 客戶端需另外驗證，不能以 Codex 的 ChatGPT 模式代替。

## 開發

```powershell
npm test
npm run build:plugin
npm run build:companion
pwsh -NoProfile -File scripts/build-native-tools.ps1
pwsh -NoProfile -File scripts/build-boot-animation.ps1
```

參見 [維護說明](docs/maintenance.md)、[測試說明](docs/testing.md) 與 [歷史量測](VALIDATION.md)。效能數字只代表記錄的場景及硬體，不保證固定 FPS 或冷啟動時間。

來源與安裝包共用發布檔案清單，排除本機設定、執行紀錄、工坊套件及連線憑證。`node scripts/release-files.cjs export .state/source-export` 產生乾淨來源，`scripts/package.ps1 -Kind Source` 建立 ZIP。

第三方來源及授權見 [THIRD_PARTY.md](THIRD_PARTY.md)。動畫素材說明位於 `assets/boot-animation/MEDIA_NOTICE.md`，程式碼授權不擴張至影片素材。舊操作記錄見 [歷史說明](docs/legacy-and-history.md)。
