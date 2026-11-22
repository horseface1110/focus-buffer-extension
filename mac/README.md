# 先緩緩：Mac Safari 版

這個資料夾是包住擴充功能的 macOS App，做法跟 [iPhone 版](../ios/README.md) 一樣：擴充功能本體在上一層的 `extension/`，Xcode 專案直接引用，沒有另外複製。App 本身只有一頁啟用教學。

需求：Xcode 27 以上，macOS 13 以上。

## 設定簽署

跟 iPhone 版共用 `ios/Local.xcconfig`（Team ID 和 bundle ID 都在裡面），沒有的話照 [ios/README.md](../ios/README.md) 建一個。Mac 和 iPhone 版用同一個 bundle ID，在 App Store Connect 是同一個 App 的兩個平台。

## 在這台 Mac 上跑

```bash
xcodebuild -project mac/FocusBuffer/FocusBuffer.xcodeproj -scheme FocusBuffer -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath ~/Library/Developer/Xcode/DerivedData/FocusBufferMac \
  -xcconfig ios/Local.xcconfig -allowProvisioningUpdates build
```

打開建好的 App 一次，然後：

1. Safari 設定 › 延伸功能，打開「先緩緩」。
2. 點工具列上的逗點圖示。找不到的話，到 顯示方式 › 自訂工具列 把它拖上去。
3. 按「授權清單中的網站」，Safari 詢問時選「一律允許」。
4. 打開清單裡的網站，應該會看到提醒畫面。

重新建置後，Safari 大約五秒內會自動載入新版，不用重開。

## 出問題時

延伸功能沒有出現、或 Safari 說「背景內容載入失敗」，先看系統記錄。zsh 有一個內建指令也叫 `log`，要用完整路徑：

```bash
/usr/bin/log show --last 5m --predicate 'process == "Safari"' | grep -i focusbuffer
```

記錄裡有 `invalid app bundle` 時，檢查簽章：

```bash
codesign --verify --deep --strict ~/Library/Developer/Xcode/DerivedData/FocusBufferMac/Build/Products/Debug/*.app
```

App 名稱是中文，Debug 版附帶的 `先緩緩.debug.dylib` 會讓簽章壞掉，所以專案已經把 `ENABLE_DEBUG_DYLIB` 關掉。不要再打開。
