# 先緩緩

打開容易分心的網站前，先停下來想一下。Chrome 擴充功能，也有 iPhone 的 Safari 版。

它不會硬性禁止你使用網站，只是加一點摩擦：喝一口水、看一下待辦、伸展 30 秒，再決定要不要繼續。圖示是一個逗點，句子讀到逗點會停一下再往下，這個擴充功能做的也是這件事。

## 功能

- 打開清單裡的網站時，先顯示整頁的提醒畫面。預設有 Instagram、Facebook、YouTube，可以自己加網域或某個路徑。
- 按下「我真的要繼續」要先等 10 秒，放行後用滿設定的時間（預設 5 分鐘）就自動關閉分頁。重新整理不會讓時間歸零。
- **待辦清單**：提醒畫面會列出還沒做完的事，可以直接勾掉。
- **分心統計**：每天打開幾次、繼續幾次、用了多久，以及最近七天的變化。
- **解鎖理由**：繼續之前寫下現在為什麼要打開，之後可以回頭看。
- **休息模式**：給自己 5 到 15 分鐘不被提醒的時間，每天有次數上限。
- **嚴格模式**：全天、指定時段，或超過每日額度後不能繼續。開著的時候不能移除網站或放寬設定，關閉要等 10 分鐘才生效。

擴充功能擋不住你到瀏覽器設定把它整個關掉。它提供的是摩擦，不是鎖。

## 安裝

### Chrome

目前還沒上架 Chrome Web Store，用「載入未封裝項目」安裝：

1. 下載或 clone 這個專案。
2. 打開 `chrome://extensions/`，開啟右上角的「開發人員模式」。
3. 點「載入未封裝項目」，選專案裡的 `extension` 資料夾。
4. 安裝後會開一個設定頁，按「授權清單中的網站」。

以前直接載入專案根目錄的舊版：先在 `chrome://extensions/` 移除，再照上面載入 `extension` 資料夾。資料夾換了，Chrome 會當成另一個擴充功能，原本的網站清單和時間上限不會帶過來，要重新設定。

### iPhone（Safari）

需要 Mac 和 Xcode，做法寫在 [ios/README.md](ios/README.md)。

## 專案結構

```
extension/        擴充功能本體，Chrome 和 Safari 共用同一份
  core.js           共用的工具與設定
  background.js     service worker：唯一寫入儲存的地方，決定每個頁面該顯示什麼
  content.js        提醒畫面與使用時間計時
  popup.html/js     設定畫面
  features/         五個功能，一個功能一個檔案
ios/              包住擴充功能的 iOS App（Xcode 專案）
tests/            單元測試與端對端測試
scripts/          圖示、打包、iOS 簽署上傳
docs/             架構、發版流程、商店文案
```

功能怎麼掛進核心寫在 [docs/FEATURES.md](docs/FEATURES.md)。

## 開發與測試

需要 Node 20 以上。

```bash
npm install
```

```bash
npm test
```

單元測試在 node 裡跑真正的 service worker。端對端測試用 Playwright 開無頭 Chromium 載入擴充功能，第一次要先裝瀏覽器：

```bash
npx playwright-core install chromium
```

圖示的原始檔是 `store-assets/icon/icon.svg`，改完用 `node scripts/render-icons.js` 重新產生各尺寸。商店截圖用 `node scripts/render-store-screenshots.js` 產生。

## 隱私

所有資料都只存在你的瀏覽器裡，不會送到任何伺服器，也沒有帳號。細節在 [PRIVACY.md](PRIVACY.md)。

## 權限

- `storage`：儲存清單、設定、待辦與紀錄。
- `scripting`：只在你授權的網站上註冊提醒畫面的程式。
- `activeTab`：按下「加入目前的網站」時讀取目前分頁的網址。
- 網站權限：選用。只會要求清單裡的網站，移除網站時一併收回。

## 發版

Chrome Web Store、TestFlight 和 App Store 的流程在 [docs/RELEASING.md](docs/RELEASING.md)。
