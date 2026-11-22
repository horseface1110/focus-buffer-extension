# 先緩緩：iPhone Safari 版

這個資料夾是包住擴充功能的 iOS App。擴充功能本體在上一層的 `extension/`，跟 Chrome 版是同一份，Xcode 專案直接引用那個資料夾，沒有另外複製。

App 本身只有一頁啟用教學，功能都在 Safari 的延伸功能裡。它只在 Safari 有作用，管不到其他瀏覽器或 App。

需求：Xcode 27 以上，iOS 17 以上的 iPhone。

## 設定簽署

Team ID 不放進版控。複製範本，填入自己的：

```bash
cp ios/Local.xcconfig.example ios/Local.xcconfig
```

`DEVELOPMENT_TEAM` 填 10 碼的 Team ID。專案預設的 bundle ID 是 `com.ncchen.focusbuffer`，屬於負責上架的帳號。其他人要在自己的帳號下建置，就在同一個檔案加上 `FOCUSBUFFER_BUNDLE_ID = com.你的名字.focusbuffer`，延伸功能會自動變成 `<這個>.Extension`。

免費的 Personal Team 可以裝到自己的 iPhone，但描述檔七天就過期。TestFlight 和 App Store 需要付費的開發者帳號。

## 裝到 iPhone

手機接上 Mac、解鎖、開啟開發者模式，然後：

```bash
./scripts/ios-run.sh
```

也可以用 Xcode：打開 `ios/FocusBuffer/FocusBuffer.xcodeproj`，在兩個 target 的 Signing & Capabilities 選自己的 Team，選手機當目的地後 Run。這樣選的 Team 會寫進專案檔，commit 前記得還原。

裝好後：

1. iPhone 的 設定 › App › Safari › 延伸功能，打開「先緩緩」。
2. 打開 Safari，點網址列旁的選單，選「先緩緩」。
3. 按「授權清單中的網站」，Safari 會問要不要允許，選「永遠允許」。
4. 打開清單裡的網站，應該會看到提醒畫面。

## 在模擬器上跑

```bash
xcodebuild -project ios/FocusBuffer/FocusBuffer.xcodeproj -scheme FocusBuffer \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build/ios-sim \
  CODE_SIGNING_ALLOWED=NO build
```

再把 `build/ios-sim/Build/Products/Debug-iphonesimulator/FocusBuffer.app` 拖進模擬器。啟用方式跟實機一樣。

## 改擴充功能之後

`extension/` 的檔案改完，重新建置 App 就會帶進去。新增到 `extension/features/` 和 `extension/icons/` 的檔案會自動包含。直接放在 `extension/` 底下的新檔案，要在 Xcode 裡加進「FocusBuffer Extension」target 的資源。

## 除錯

手機接上 Mac，在 iPhone 的 設定 › App › Safari › 進階 打開「網頁檢閱器」，然後在 Mac 的 Safari › 開發 › 你的 iPhone 底下，可以檢查延伸功能的背景頁面和 popup。

## 上架

見 [docs/RELEASING.md](../docs/RELEASING.md)。
