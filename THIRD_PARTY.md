# Third-party rendering engine

## Dragon Codex Boot animation

`src/boot-animation/DragonCodexBoot.cs` and its DPI manifest are adapted from [yushua0808-cpu/dragon-codex-boot](https://github.com/yushua0808-cpu/dragon-codex-boot), commit `c63a203e5857e85fb3c8a9891eddb570e7a27b54`, under MIT. The preserved upstream license is `assets/boot-animation/LICENSE`; provenance is in `upstream.json`. This local adaptation removes application launch and shortcut integration, requires a scoped readiness file, preserves the host geometry and rejects Electron helper windows.

The upstream demonstration video `assets/boot-animation/startup.mp4` is included for the user's requested local startup playback. Its media notice is preserved as `MEDIA_NOTICE.md`. The source-code MIT license does not grant additional rights to the character artwork, soundtrack or other media. No Workshop media is added by this animation feature.

`assets/webwallgl/webwallgl.global.min.js` is the unmodified browser bundle of WebWallGL 3.0.0 by oneincase, obtained from the user's installed npm package. It is distributed under MIT; the accompanying copyright and license are preserved at `assets/webwallgl/LICENSE`.

Upstream: https://github.com/oneincase/webwallgl

The integration design was informed by dsh-plugin-wallpaper-engine 1.3.3 (MIT), particularly its Scene renderer adapter and local asset serving. The DSH plugin and its runtime settings remain unmodified. Codex's host adapter, isolated renderer bridge, window monitor and resource server are separate implementations.

## Attached sidebar

The attached native sidebar embeds the already installed Microsoft Edge WebView2 Runtime. `assets/webview2/` contains the unmodified .NET Core Core/WinForms controls and x64 loader from Microsoft.Web.WebView2 1.0.4314.35, under the accompanying Microsoft BSD-style license in LICENSE.txt. The official NuGet catalog SHA512 and extracted file SHA256 values are recorded in sdk.json. No WebView2 browser runtime or host application files are redistributed.

Reference: https://github.com/elysia395/dsh-wallpaper-engine

Wallpaper Engine Workshop content is read from the selected local installation. No Workshop package, illustration, audio or video is copied into the portable source archive.

## Local control plugin

The control plugin uses @modelcontextprotocol/sdk 1.32.2 (MIT), @modelcontextprotocol/ext-apps 1.7.5 (MIT), @openai/mcp-extensions 0.2.1 (Apache-2.0), and Zod 4.6.6 (MIT). The browser and stdio entrypoints are bundled with esbuild 0.25.12 (MIT). Exact dependency versions and integrity values are recorded in package-lock.json; generated plugin packages include THIRD_PARTY_NOTICES.txt with dependency license texts.

Zod is overridden consistently to 4.6.6 to include the constrained-collection memory fix; the initial 4.4.3 pin was not shipped. The plugin does not bundle Node.js, PowerShell, Microsoft Edge, host application files, or Workshop media.
