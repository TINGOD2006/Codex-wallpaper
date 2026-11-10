# 驗證

`npm ci` 後執行 `npm test`，涵蓋設定、遷移、材質、即時／靜態切換、渲染池、快取、接入恢復、標題列程序、MCP、掛載隔離工具及發布清單。

Windows 下另外執行自己的 fixture 測試。CIM、COM 或暫存 junction 在受限沙箱可能遇到權限限制：

```powershell
pwsh -NoProfile -File test/windows-entry-hint.Tests.ps1
pwsh -NoProfile -File test/windows-entry-feedback.Tests.ps1
pwsh -NoProfile -File test/windows-entry-watch.Tests.ps1
pwsh -NoProfile -File test/windows-launch-concurrency.Tests.ps1
pwsh -NoProfile -File test/windows-launch-fail-open.Tests.ps1
pwsh -NoProfile -File test/windows-native-activation.Tests.ps1
pwsh -NoProfile -File test/windows-boot-visibility.Tests.ps1
```

UI fixture 會顯示自己的測試視窗，請另行手動執行：

```powershell
node (Resolve-Path test/companion/caption-live.cjs)
```

實際驗收包括：完全退出後冷啟動動畫、靜態接動態背景、原版圖示分組、正常完成最大化、Esc、背景叫回不重播、最小化超過 70 秒後恢復、側欄可操作、省電時引擎停止。不保證所有未來宿主版本或工坊素材相容。

`npm run build:companion` 重建乾淨安裝目錄，大小與 SHA256 記錄於 install-manifest.json。發布前從 `release-files.cjs export` 的乾淨來源重新執行 npm ci、測試及建置，避免依賴開發機遺留資料。
