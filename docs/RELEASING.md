# 發版流程

「先緩緩」有兩個發行管道，版本號要一致：

- **Chrome Web Store**：上傳 `extension/` 的 zip。
- **App Store（iPhone）**：用 `scripts/ios-archive.sh` 簽署並上傳，先進 TestFlight，再送審。

## 一次性準備

### Chrome Web Store

1. 到 [Chrome Web Store 開發人員資訊主頁](https://chrome.google.com/webstore/devconsole) 註冊，一次性費用 5 美元。這是 Google 帳號，跟 Apple 開發者帳號無關，誰註冊都可以。
2. 商店素材都在 `store-assets/`：128×128 圖示（`icon/chrome-store-128.png`）、1280×800 截圖（`screenshots/chrome/`）、440×280 宣傳圖（`promo-small-440x280.png`）。文案在 [store-listing.md](store-listing.md)。

### App Store

App 掛在有付費 Apple Developer Program 的帳號底下。目前是 Team `V7H59QAJPL`，bundle ID `com.ncchen.focusbuffer`。

1. **Xcode 登入帳號**：Xcode ▸ Settings ▸ Accounts。
2. **`ios/Local.xcconfig`**：從 `Local.xcconfig.example` 複製，`DEVELOPMENT_TEAM` 填 Team ID。這個檔案不進版控。
3. **註冊 bundle ID**：不用手動做。第一次跑 `scripts/ios-archive.sh` 時，Xcode 會自動在帳號裡註冊 `com.ncchen.focusbuffer` 和 `com.ncchen.focusbuffer.Extension`，並建立憑證和描述檔。
4. **在 App Store Connect 建 App**：我的 App ▸ 新增 App，平台 iOS，bundle ID 選上一步註冊的那個，主要語言繁體中文。名稱要全站唯一，備案寫在 [store-listing.md](store-listing.md)。
5. **填 App 資訊**：隱私權政策網址用 GitHub 上的 `PRIVACY.md`；App 隱私權選「未收集資料」；年齡分級照問卷填，都答「無」會得到 4+；類別選生產力工具。

換別的帳號上架時，改 `ios/Local.xcconfig` 的 Team ID，並加上 `FOCUSBUFFER_BUNDLE_ID = <新的 bundle ID>`。

## 每次發版

下面用 `1.1.0` 當例子。

### 1. 改版本號

版本號在兩個地方：Xcode 專案的 `MARKETING_VERSION`（App 和延伸功能各一處），以及 `extension/manifest.json` 的 `version`。

```bash
NEW=1.1.0
sed -i '' -E "s/(\"MARKETING_VERSION\": \")[0-9.]+/\1$NEW/" ios/FocusBuffer/FocusBuffer.xcodeproj/project.xcproj
sed -i '' -E "s/(\"version\": \")[0-9.]+/\1$NEW/" extension/manifest.json
git diff --stat
```

`git diff --stat` 應該只列出這兩個檔案。build number 不用管，每次建置自動用時間戳記。兩邊版本不一致時，`ios-archive.sh` 會直接停下來。

### 2. 跑測試

```bash
npm test
```

### 3. Chrome Web Store

```bash
./scripts/package-chrome.sh
```

產出 `dist/focus-buffer-chrome-1.1.0.zip`。到開發人員資訊主頁上傳，填寫「隱私權實務」分頁（各權限的用途寫在 [store-listing.md](store-listing.md)），送審。

### 4. TestFlight

```bash
./scripts/ios-archive.sh --upload
```

腳本會 archive、用自動簽署匯出、上傳到 App Store Connect。上傳後 Apple 要處理幾分鐘到半小時，完成後 build 會出現在 TestFlight。

- **內部測試**不用審核。在 App Store Connect ▸ 使用者與存取權限 把測試的人加進團隊（「開發人員」角色就夠），再到 TestFlight 把他們加進內部群組。
- 不加 `--upload` 只會在 `build/ios/` 產出簽好的 `.ipa`，用來檢查簽署有沒有問題。

### 5. 送審

在 App Store Connect 的版本頁面選剛上傳的 build，上傳 `store-assets/screenshots/iphone-6.9/` 的截圖（6.9 吋，1320×2868），貼上文案，送出審核。審核備註也在 [store-listing.md](store-listing.md)，記得貼上，裡面說明了怎麼啟用延伸功能。

### 6. Mac 版

```bash
./scripts/mac-archive.sh --upload
```

Mac 和 iPhone 版是同一個 App 的兩個平台。在 App Store Connect 的 App 頁面左側選「macOS」，版本頁選剛上傳的 build，上傳 `store-assets/screenshots/mac/` 的截圖（2560×1600），文案和審核備註跟 iPhone 版一樣，啟用步驟改成 Mac 的（見 [mac/README.md](../mac/README.md)）。不加 `--upload` 只會在 `build/mac/` 產出簽好的 `.pkg`。

### 7. 打 tag

```bash
git tag -a v1.1.0 -m "先緩緩 1.1.0"
git push origin v1.1.0
```

## 出問題時

| 狀況 | 處理方式 |
|---|---|
| `ios-archive.sh` 說找不到 `Local.xcconfig` 或 Team ID 沒填 | 照「一次性準備」第 2 步做 |
| Archive 失敗，訊息有 `No Account for Team` | Xcode 還沒登入那個 Team 的帳號 |
| Archive 失敗，訊息有 `bundle identifier ... is not available` | 這個 bundle ID 已經被別的 Team 註冊。在 `Local.xcconfig` 設自己的 `FOCUSBUFFER_BUNDLE_ID` |
| 上傳失敗，訊息有 `No suitable application records were found` | App Store Connect 還沒建這個 bundle ID 的 App（「一次性準備」第 4 步） |
| 上傳失敗，說版本或 build 已存在 | 同一個版本號已經送審通過。照第 1 步把版本號往上加 |
| 審核以 4.2（功能太少）退回 | 在回覆裡說明這是 Safari 延伸功能，附上啟用步驟和功能截圖。下一步可以把統計和待辦也做進 App 本體 |
