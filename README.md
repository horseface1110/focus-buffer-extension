<div align="center">

<img src="extension/icons/icon-256.png" width="96" height="96" alt="先緩緩的圖示：一個逗點">

# 先緩緩

打開分心網站前，先停一下。

![Chrome](https://img.shields.io/badge/Chrome-Manifest_V3-2d7569?logo=googlechrome&logoColor=white)
![Safari iOS](https://img.shields.io/badge/Safari-iOS_17+-2d7569?logo=safari&logoColor=white)
![Safari macOS](https://img.shields.io/badge/Safari-macOS_13+-2d7569?logo=safari&logoColor=white)

<img src="store-assets/screenshots/chrome/01-overlay.png" width="760" alt="在 YouTube 上出現的提醒畫面">

</div>

打開清單裡的網站時，先蓋上一個提醒畫面。想繼續就等 10 秒，時間到分頁會自動關閉。不封鎖，只加一點摩擦。

- **待辦清單**：提醒畫面上列出還沒做完的事
- **分心統計**：今天打開幾次、用了多久、最近七天
- **解鎖理由**：繼續前先寫下為什麼
- **休息模式**：幾分鐘內不跳提醒
- **嚴格模式**：指定時段或額度用完後不能繼續

## 安裝

| 平台 | 狀態 |
|---|---|
| Chrome | 尚未上架，在 `chrome://extensions/` 開啟開發人員模式，「載入未封裝項目」選 `extension` 資料夾 |
| iPhone（Safari） | App Store 審核中，自行建置見 [ios/README.md](ios/README.md) |
| Mac（Safari） | Mac App Store 審核中，自行建置見 [mac/README.md](mac/README.md) |

用過舊版（載入專案根目錄）的話，先移除舊版再載入 `extension`，網站清單要重新設定。

資料只存在你的裝置上，沒有帳號、沒有伺服器。詳見 [PRIVACY.md](PRIVACY.md)。

## 開發

```bash
npm install
```

```bash
npm test
```

Chrome、iPhone、Mac 共用 `extension/` 這一份程式。功能架構見 [docs/FEATURES.md](docs/FEATURES.md)，發版流程見 [docs/RELEASING.md](docs/RELEASING.md)。
