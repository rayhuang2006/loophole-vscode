# 改這個套件

## 文法是生成的，不要手改

`syntaxes/*.tmLanguage.json` 是產物。改它們沒有用——CI 會重新生成然後比對，
不一樣就紅燈。要改就改 `tools/gen-grammars.mjs`。

```
loophole --keywords          上游，唯一來源（從它的 lexer 和 parser 讀的同一張表）
        ↓  release 附 keywords.json
tools/keywords.json          抓下來，進版控
        ↓  tools/gen-grammars.mjs
syntaxes/*.tmLanguage.json   生成物，進版控，因為編輯器要讀它
```

```bash
npm run keywords   # 從最新 release 更新字表
npm run gen        # 重新生成兩份文法
npm test           # 用 VS Code 自己的 tokenizer 驗
npm run check      # 以上全部 + 確認沒有人手改生成物
```

**為什麼不讓編譯器直接生成 TextMate 文法？**
因為 scope 命名（`keyword.control`、`entity.name.function` 之類）是 VS Code 的詞彙，
不是語言的知識。放進編譯器的話，以後多支援一個編輯器就要改編譯器一次。
**上游吐資料，下游決定格式。**

## 測試測的是什麼

`npm test` 跑三支，全部用真東西，沒有 fixture：

**`grammar-check.mjs`** 跑的是 **`vscode-textmate` + `vscode-oniguruma`——VS Code
本身用的 tokenizer**，不是只驗 JSON 合法。因為一份文法可以完全合法、
卻讓每個關鍵字都沒顏色。三個性質：

1. **`keywords.json` 裡的每一個字都必須被上色。**
   字表沒有在測試裡重打一遍，所以編譯器多一個保留字而文法漏掉時會直接失敗，
   沒有 fixture 要跟著更新。
2. **關鍵字不能匹配到更長的識別字裡面。**
   `invariant` 裡的 `in`、`really` 裡的 `real`、`format` 裡的 `format`——
   這是生成的 alternation 最典型的壞法，而且在有人把暫存器命名成 `format`
   之前都看不出來。
3. 註解、字串、`uint<N>` 的寬度、願望名、規則名的 scope 是否如預期。

**`diagnostics-check.mjs`** 用**真的 wasm 編譯器**判真的原始碼，
然後檢查 `verdict.js` 吐出什麼。上面那張嚴重度表每一列都有對應的檢查——
把 `EXPLOIT` 改成 `Error` 會紅。罐頭 JSON 做不到這件事：
編譯器改了輸出之後，fixture 會永遠綠。單獨檢查精靈的路徑（`checkGenie`
過同一個 `verdict.js`）也在這裡：好精靈零診斷，壞精靈一個錯誤、落在缺括號的那行。

**`extension-check.mjs`** 真的呼叫 `activate()`，對著一個假的 VS Code API，
但編譯器是真的、`extension.js` 是真的。它證明的是「診斷有送到」：
`activate` 不會拋、wasm 從 `context.extensionPath` 載得起來、
`# genie:` 找得到檔案、範圍落在它指責的那段文字上、關掉檔案波浪線會消失。

**沒有這一層，套件可以裝上去完全不動而其他檢查全綠**——
這個專案已經以另一種形式出過一次這種貨：一個被快取住的 web worker，
對每個問題都用沉默回答。

`npm run test:editor` 再上一層：下載一個真的 VS Code 跑起來，
在裡面讀 `vscode.languages.getDiagnostics()`。它測的是 manifest——
`main` 指得到嗎、`.wish` 有沒有真的被認成 `wish` 語言、
打開檔案會不會自己啟動、編輯之後波浪線會不會跟著動。
它也真的把一個精靈改壞，確認錯誤落在精靈自己身上、
而願望只在 `# genie:` 那行得到一句 warning（上面那條歸屬規則）。
這些東西在別的地方一行都不會被執行到。

一個要注意的細節：**`activationEvents` 那個欄位不是啟動的機制**。
清空它什麼都不會變，因為 VS Code 會從 `contributes.languages` 自己推導
`onLanguage:wish`。那個欄位是文件。真正會被抓到的是 `main` 指錯，
和 `.wish` 沒有被任何語言認領（檔案會以 plaintext 打開）。

CI 另外做四件事：確認 `syntaxes/` 就是生成器的產物，
確認 `wasm/` 是最新 release 的位元組，
確認 `.vsix` 裡真的有 `wasm/` 和 `src/`（`.vscodeignore` 是一份「不要包什麼」的清單，
寫錯的結果是一個裝得乾乾淨淨然後什麼都不做的套件），
以及每週檢查上游有沒有新的保留字（那個是警告，不是失敗——
文法刻意跟隨**已發布的**語言版本，落後一版不是錯）。

## scope 對應

| | 上色成 |
| --- | --- |
| `register` `attribute` `people` `wish` `define` `promise` | `keyword.control` |
| 六個操作 `sub` `add` `widen` `set` `kill` `revive` | `support.function.operation` |
| `uint<N>` | `storage.type` + 寬度另外標 `constant.numeric.width` |
| 願望的名字 | `entity.name.function` |
| `define` 綁的名字 | `support.function.alias` |
| 規則／不變量／概念的名字 | `entity.name.type` |
| `surface` `ast` | `constant.language.layer` |
| `written` `real` | `keyword.control.column` |

有兩個是刻意的，改之前先想清楚：

**`define` 綁的別名跟真正的操作同色。**
別名軸就是「名字和它指的東西不是同一件事」——編輯器把 `mercy` 顯示成跟 `kill`
一樣，是在說實話。

**`written` 和 `real` 有自己的 scope。**
那兩欄的落差是整個語言的核心（規則成立、本意碎了），值得讓主題有辦法把它們挑出來。

## 上色和診斷是兩個獨立的系統

它們完全無關，而且**誰也取代不了誰**：

- **上色**跑在每一次按鍵之後，看到的檔案九成時間是打到一半的、壞的。
  它絕對不能放棄，所以它是一份 TextMate 文法。
- **編譯器的 parser** 遇到壞檔案的職責是**拒絕**——那不是缺點，那是它的工作。
  所以診斷呼叫編譯器的 WebAssembly 版本拿 `--json`，但不能拿它來上色。
  VS Code 幫 C++ 上色時也不是叫 clang。

## 診斷

```
wasm/loophole.{js,wasm}    編譯器本體，從 release 抓的，進版控
        ↓
src/extension.js           讀檔、呼叫、放範圍。膠水
        ↓
src/verdict.js             決定什麼算問題。不 import vscode
```

**`verdict.js` 刻意不依賴 VS Code。** 這個功能唯一在「決定事情」的地方就是它，
而那個決定不該需要跑一個編輯器才能檢查。

### 嚴重度政策

| 判決 | 嚴重度 | 為什麼 |
| --- | --- | --- |
| 讀不懂 | `Error` | 什麼都沒被判。這裡唯一真正的問題 |
| 精靈拒絕 | `Information` | 合法的結果。規則正常運作，不是誰的 bug |
| `EXPLOIT` | `Information` | 你贏了。顯示是因為你想看，`Information` 是因為它不能算進錯誤數 |
| 乾淨 | 不顯示 | 每行都標註等於重要的那些看不見 |

**這是整個功能的立論。** 在這個語言裡破掉不變量就是目標，
所以編輯器左下角那個紅色數字只能數一件事：編譯器讀不懂的檔案。
改這張表之前先想清楚你在說什麼。

### 歸屬：每個檔案只畫自己的線

有兩種檔案、兩個編譯器入口，界線要清楚，不然同一行會有兩個主人在搶。

- **`.wish`** 走 `judge(wish, genie)`。願望自己的錯誤畫在願望上。
- **`.genie`** 走 `checkGenie(genie)`（上游的 `--check-genie`）——**只查語法**。
  精靈的不變量可以引用願望世界裡的 register，那個 register 存不存在
  光看精靈不知道，所以孤零零的精靈只能查到「合不合語法」，查不到語義。

關鍵規則：**願望永遠不會替精靈畫線。** 當一個願望引用的精靈讀不懂，
`judge` 會回一個 `file: genie` 的錯誤——這時候願望**不是**去精靈檔案上畫，
而是在自己的 `# genie:` 那行放一個 warning 說「沒辦法判」，
精確的錯誤留給精靈檔案自己（`checkGenie`）去顯示。

這修掉了一個舊行為：精靈**沒有**開著的時候，願望會拿精靈的行號在自己的
程式碼上劃紅線，非常有自信地指著一段完全沒問題的願望。現在精靈的錯誤
只會出現在精靈身上，願望上只有一句「你引用的精靈壞了」。

### 為什麼 wasm 要進版控

它是這個 repo 裡唯一不能在本機重新產生的檔案——編譯 wasm 要 emsdk。
所以 CI 的檢查是**「committed 的位元組必須等於 release 的位元組」**（`npm run wasm`
之後 `git diff --exit-code wasm/`）。不然就會出現一個沒有任何 tag 指得到的編譯器。

進 `.vsix` 而不是執行時下載，有兩個理由：要能在飛機上用，
而且它必須跟同一個套件裡的文法描述同一個語言版本——
執行時抓的版本會漂走，然後高亮成關鍵字藍色的字被劃紅線。

`npm run wasm` 順便驗這件事：抓下來之後真的把它跑起來問 `versions()`，
跟 `keywords.json` 的語言版本比對，不一樣就失敗。

## 測試測的是什麼

## 發布

**改 `package.json` 的 `version` 就是決定要發布。** 其餘全自動：

```
push 到 main  →  比對 package.json 和 Marketplace 上的版本
                    ↓ 不同
              重新生成文法 + 跑 tokenizer 測試  →  發布  →  打 tag
```

版號沒變的話什麼都不會發生，所以改 README 不會多出一個版本。
`vsce show` 不需要認證，所以那個比對在動用 token 之前就完成了。

發布用的是 `VSCE_PAT` 這個 repository secret。要重新產一個 PAT 的話：
https://dev.azure.com/ → 設定 → Personal access tokens → New Token，
**Organization 必須選 All accessible organizations**（選單一組織會發不出去），
Scopes 展開全部之後勾 **Marketplace → Manage**。

手動發布（不需要，但偶爾有用）：

```bash
npx @vscode/vsce package                  # 只產生 .vsix，不上傳
npx @vscode/vsce publish --pat <token>
```
