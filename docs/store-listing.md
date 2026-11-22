# 商店文案

App Store 和 Chrome Web Store 的上架文字。主要語言是繁體中文，介面目前也只有繁體中文。

名稱、副標題和關鍵字不要出現 Instagram、Facebook、YouTube（App Store 審核準則 2.3.7 和 4.1）。描述裡可以舉例提到，並附上沒有關聯的聲明。

## 名字與圖示

- **名字**：先緩緩。台灣人平常就會說「先緩緩」，意思是不急，等一下再說。
- **英文名**：Focus Buffer，沿用專案原本的名字。
- **象徵物**：逗點。句子讀到逗點會停一下再往下讀，跟句點不同，它不是結束。這個擴充功能也只是讓你停一下，要不要繼續由你決定。
- **圖示**：深綠底上一個米白色的逗點。原始檔是 `store-assets/icon/icon.svg`。

## App Store（iPhone）

類別：生產力工具（主要）、健康與健身（次要，可不填）。價格：免費。年齡分級：4+。

**名稱**（≤30 字元）：先緩緩 - 分心緩衝器

名稱被占用時的備案：「先緩緩：分心網站緩衝」、「先緩緩 Focus Buffer」。

**副標題**（≤30 字元）：打開分心網站前，先停一下

**宣傳文字**（≤170 字元，可隨時修改）：
想滑一下社群，結果一小時過去了？先緩緩會在你打開容易分心的網站前擋一下，等十秒、想一想，再決定要不要繼續。不硬性封鎖，只多一點摩擦。

**關鍵字**（≤100 bytes，名稱裡已有的字不用重複）：
專注,分心,拖延,自律,網站,限制,封鎖,番茄鐘,待辦,習慣,Safari,延伸功能

**支援網址**：https://github.com/horseface1110/focus-buffer-extension/issues

**隱私權政策網址**：https://github.com/horseface1110/focus-buffer-extension/blob/main/PRIVACY.md

**描述**：

先緩緩是 Safari 的延伸功能。打開你自己列出的網站時，它會先顯示一個提醒畫面：喝口水、看一下待辦、伸展 30 秒，再決定要不要繼續。

它不會硬性封鎖網站。想繼續就等十秒，放行後用滿設定的時間，分頁會自動關閉。

主要功能：

• 提醒畫面
預設提醒三個常見的社群和影音網站，也可以加入任何網域，或只限制某個路徑。

• 待辦清單
提醒畫面會列出你還沒做完的事，可以直接勾掉。想分心的時候，剛好看到該做什麼。

• 分心統計
每天打開幾次、繼續幾次、用了多久，還有最近七天的變化。

• 解鎖理由
繼續之前寫下現在為什麼要打開。之後回頭看，會發現很多次其實沒有理由。

• 休息模式
給自己 5 到 15 分鐘不被提醒的時間，每天有次數上限。

• 嚴格模式
全天、指定時段，或超過每日額度後就不能繼續。開著的時候不能移除網站，關閉要等十分鐘才生效，免得一時衝動就關掉。

隱私：
沒有帳號、沒有伺服器、沒有追蹤。清單、待辦和紀錄都只存在這台裝置上。延伸功能只會要求你加進清單的網站的權限。

注意：
• 只在 Safari 有作用，管不到其他瀏覽器和 App。
• 安裝後要到 設定 › App › Safari › 延伸功能 打開它，App 裡有步驟說明。
• 延伸功能可以在 Safari 設定裡關掉。它提供的是摩擦，不是鎖。

先緩緩是開源專案，與描述中提到的任何網站都沒有關聯。

**新功能**（第一版不用填）

**審核備註**（App Review Information ▸ Notes）：

```
This app is a Safari Web Extension. To test it:

1. Open Settings > Apps > Safari > Extensions and turn on "先緩緩".
2. Open Safari, tap the page menu next to the address bar, then tap "先緩緩".
3. Tap "授權清單中的網站" (grant access to the listed sites) and choose "Always Allow".
4. Visit youtube.com. A full-page pause screen appears. "關掉這頁" closes the tab;
   "我真的要繼續" continues after a 10-second wait.

The extension only requests access to sites the user adds to the list. It stores
everything locally with browser.storage.local and makes no network requests.
No account or login is needed.
```

**截圖**（6.9 吋，1320×2868）：已經做好五張，在 `store-assets/screenshots/iphone-6.9/`，照檔名順序上傳。每張是一句標題加上手機裡的實際畫面。

| 檔案 | 標題 | 畫面 |
|---|---|---|
| `01-overlay.png` | 想滑一下？先緩緩 | 提醒畫面 |
| `02-todos.png` | 先看到該做的事 | 待辦清單 |
| `03-stats.png` | 今天打開了幾次 | 分心統計 |
| `04-modes.png` | 要認真時開嚴格模式 | 休息與嚴格模式 |
| `05-sites.png` | 哪些網站你決定 | 網站清單 |

畫面是用擴充功能的真實介面加上範例資料渲染出來的。介面或標題改了之後重新產生：

```bash
node scripts/render-store-screenshots.js
```

標題寫在腳本開頭的 `FRAMES`。

## Chrome Web Store

類別：工作效率 ▸ 工作流程與規劃。語言：中文（繁體）。

**名稱**（≤75 字元）：先緩緩 - 分心緩衝器

**摘要**（≤132 字元）：打開容易分心的網站前先緩一緩：喝口水、看看待辦，再決定要不要繼續。

**說明**：用上面 App Store 的描述，把「Safari 的延伸功能」改成「Chrome 擴充功能」，拿掉「注意」那一段的前兩點。

**截圖**（1280×800）：五張，在 `store-assets/screenshots/chrome/`，由同一支腳本產生。宣傳圖是 `store-assets/promo-small-440x280.png`。

**單一用途說明**（Single purpose）：
在使用者自己列出的網站上，先顯示一個提醒畫面，並限制每次放行後的使用時間。

**權限用途**（隱私權實務分頁會逐項問）：

| 權限 | 用途 |
|---|---|
| `storage` | 儲存使用者的網站清單、設定、待辦，以及使用時間和次數的統計。全部存在本機。 |
| `scripting` | 只在使用者授權的網站上註冊顯示提醒畫面的內容腳本。 |
| `activeTab` | 使用者按下「加入目前的網站」時，讀取目前分頁的網址。 |
| 主機權限（選用） | 只在使用者把網站加進清單時要求那個網站的權限，用來顯示提醒畫面和計算停留時間。移除網站時收回。 |

**遠端程式碼**：沒有使用。

**資料使用**：不收集任何使用者資料。三項聲明（不販售、不用於無關用途、不用於信用評估）都勾選。
