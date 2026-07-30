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

`npm test` 跑五支，全部用真東西，沒有 fixture：

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

**`assist-check.mjs`** 一樣用真的 wasm，檢查 lens 寫什麼、hover 說什麼、
補全給什麼。最重要的一條是拿 `keywords.docs` 去比對 hover 的文字——
**插件不准自己帶一份語義的散文**，帶了就紅。另外盯著 register 的值
從頭到尾是字串（`18446744073709551615` 一旦被 `Number()` 碰到就變成
`...552000`），和寬度跟著 `widen` 走而不是宣告值。

**`run-check.mjs`** 檢查指令怎麼組，和 problemMatcher 讀不讀得懂編譯器的錯誤。
最重要的兩條：`--genie` 一定要被加上去（而且是拿真編譯器驗「換精靈會換判決」，
不是驗字串），以及 matcher 的 regex 是對著**剛剛才產生的**真實診斷跑的。
另外驗一個容易寫反的方向：`EXPLOIT` **不可以**被 matcher 撿成問題——
它是成功，而一般編譯器的 matcher 寫法會把它當錯誤。

**`extension-check.mjs`** 真的呼叫 `activate()`，對著一個假的 VS Code API，
但編譯器是真的、`extension.js` 是真的。它證明的是「診斷有送到」：
`activate` 不會拋、wasm 從 `context.extensionPath` 載得起來、
`# genie:` 找得到檔案、範圍落在它指責的那段文字上、關掉檔案波浪線會消失。
三個 provider 也在這裡被當成 VS Code 那樣呼叫一次——證明它們有註冊、
讀的是快取的判決而不是再判一次。執行那條路徑也在這裡：`child_process` 一起被
攔截成假的，所以「沒裝 binary」「版本一樣」「版本不同」三種情況都測得到，
而且在一台從來沒裝過編譯器的 CI runner 上也穩定。

**沒有這一層，套件可以裝上去完全不動而其他檢查全綠**——
這個專案已經以另一種形式出過一次這種貨：一個被快取住的 web worker，
對每個問題都用沉默回答。

`npm run test:editor` 再上一層：下載一個真的 VS Code 跑起來，
在裡面讀 `vscode.languages.getDiagnostics()`。它測的是 manifest——
`main` 指得到嗎、`.wish` 有沒有真的被認成 `wish` 語言、
打開檔案會不會自己啟動、編輯之後波浪線會不會跟著動。
它也真的把一個精靈改壞，確認錯誤落在精靈自己身上、
而願望只在 `# genie:` 那行得到一句 warning（上面那條歸屬規則），
然後用 `vscode.executeCodeLensProvider` 那組命令去問 lens / hover / 補全——
那是編輯器自己問的路徑，所以這是唯一能證明「provider 真的被接到」的地方：
把 provider 註冊到一個沒有東西會解析成的語言，其他檢查全部照樣綠。
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
src/extension.js           讀檔、呼叫、放範圍、快取判決。膠水
        ↓  ↓
src/verdict.js             決定什麼算問題（診斷）
src/assist.js              lens 寫什麼、hover 說什麼、補全給什麼
```

**`verdict.js` 和 `assist.js` 都刻意不依賴 VS Code。** 這個功能真正在「決定事情」
的地方就是它們兩個，而那些決定不該需要跑一個編輯器才能檢查。

### 一份判決，四個視角

診斷、CodeLens、hover、補全全部讀 `extension.js` 裡快取的**同一份** `--json`。
兩個理由：三個視角不可能互相矛盾，而且滑一下鼠標不該讓編譯器再跑一次。
判決更新時 `lensChanged.fire()` 叫 VS Code 重新拿 lens。

## 執行

環境式的功能（診斷、lens、hover、補全）全部走套件內含的 wasm。
**「執行」不走 wasm，走使用者 PATH 上真正的 `loophole`，而且輸出到終端機。**

```
src/run.js          指令怎麼組。純函式，不 import vscode
src/extension.js    loophole.run 命令 + TaskProvider
package.json        播放鍵(editor/title/run)、taskDefinitions、problemMatcher
```

### 為什麼不 fallback 到 wasm

沒裝本體的時候，播放鍵會直說並給安裝指令，**不會偷偷用內含的 wasm 代跑**。

理由不是「怕它們判得不一樣」——`make wasm-check` 每次都在證明兩者逐字相同。
理由是：偷偷代跑會讓「執行」這個**動作**在不同機器上是不同的事。
而這個動作存在的意義就是它跟別人做的是同一件事。

### `--genie` 不是可選的

**編譯器不讀 `# genie:` 那行。** 那是 `make run` 和這個插件的慣例，不是語言的。
一個寫了 `# genie: mortal.genie` 的願望，用 `loophole w.wish` 跑會報 `broke I3`
（內建精靈），用 `loophole --genie mortal.genie w.wish` 跑會報 `broke Life`。

所以 `run.js` 必須自己補上這個旗標，不然按下播放鍵會跟三吋之上的波浪線互相矛盾。
`tools/run-check.mjs` 裡有一條直接用編譯器驗這件事——不是驗字串，是驗「換精靈
真的會換判決」。

### 版本偏移

畫波浪線的是內含的 wasm，執行的是 PATH 上的 binary。**它們可能是不同的 build。**

這不是假想：做這個功能的時候，開發機上裝的是 1.3.1，而套件帶的是 1.14.0。
編輯器和終端機是兩個不同的編譯器，而沒有任何東西講過一句話。

現在版本不同時會警告一次（一次，不是每次——每次都跳的警告等於沒有警告），
但**不擋**：舊 binary 還是能跑，使用者也可能是刻意釘住的。

### problemMatcher 是這個插件唯一可以讀散文的地方

終端機吐的是文字，沒有別的東西可以解析，所以 `problemMatcher` 的 regex 必須讀
`error:` 和 `-->` 那兩行。§10.1 說散文可以隨時改寫，所以這件事很危險——
`tools/run-check.mjs` 因此拿**剛剛才由真編譯器產生的**輸出去比對，不用罐頭字串。
不然哪天診斷格式改了，Problems 面板會安靜地變空。

task 的 `ShellExecution` 會帶 `NO_COLOR=1`。編譯器認這個變數，而 task 跑在 pty 裡，
不設的話它會把 ANSI escape 吐進 matcher 要讀的那幾行。
播放鍵那條路徑**不設**，因為那是給人看的，有顏色比較好。

### 只開單一檔案時沒有 task

VS Code 的 task 是 workspace 範圍的，沒開資料夾就不會有。播放鍵不受影響
（它是命令不是 task）。`tools/vscode-run.mjs` 因此會建一個暫存資料夾當工作區
再啟動 VS Code——不然 task provider 看起來會像壞了，其實好好的。

### 呈現不能有損

**編輯器可以改措辭，不可以把兩個判決合併成一句話。**

這是這個 repo 唯一一條「以後每加一個視角都要重新遵守」的規則，
而它防的失敗非常安靜：編譯器照樣完美地算出 `fooled` 和 `violated`，
`--json` 照樣兩個都帶，只有**使用者**不再被告知有這個差別——
而使用者到那時候只看 lens。`fooled` 對 `violated` 就是兩欄不變量，
就是這整個專案的立論。在最後三吋弄丟它，等於弄丟它。

`tools/assist-check.mjs` 底下那段釘的是**單射**，不是相等：
凡是編譯器判得不一樣的兩個程式，呈現出來也必須不一樣。
它不斷言任何一句話該長怎樣，所以：

| 改動 | |
| --- | --- |
| `EXPLOIT · broke I2` 改成 `破了 · broke I2` | 綠。措辭自由 |
| `fooled`/`violated` 都印成 `broke` | **紅**，並指出是哪兩個判決撞在一起 |
| corpus 不再產出 fooled | **紅**，說「你不再測到 fooled」而不是安靜縮水 |

最後那條是在防這個測試自己爛掉：fixture 一旦不再產出它名字說的東西，
檢查會退化成只涵蓋三個類別然後照樣通過。

**加新視角（inlay hints、大綱、狀態列……）的時候，把它加進那段的 `seen` 表。**
沒加的話，那個視角就是沒人看管的。

### hover 的說明不能寫在插件裡

`--keywords` 的 `docs`（編譯器 1.13.0 起）給每個保留字一句話和一行語法。
**插件不准自己寫。** 一旦寫了，語義就有第二份說法，可以自由地跟本體漂走而沒人發現。
`tools/assist-check.mjs` 是拿 `keywords.docs` 去比對的，
所以「插件自己帶散文」這件事會直接紅。

operation 的語法是從 `OperandKind` 生成的，不是手寫在旁邊——
不可能出現「文件說吃寬度、parser 要立即值」。

### 名字是刮出來的，判決不是

補全需要名字。register 和 wish 名從判決來（編譯器解析過的）；
people、attribute、define 不在 `--json` 裡，所以是用 regex 從原始碼刮的。

**刮取只允許在這裡，而理由是爆炸半徑。** 刮錯一個名字 = 下拉選單多一個沒人選的項目。
刮錯一個判決 = 騙使用者他的 exploit 成功了。這兩件事不是同一個風險等級，
而「絕對不要重寫編譯器」保護的是後者。刮取也是檔案還不能解析時唯一能用的東西——
**而那正是有人在打字的時候。**

### register 的值是字串

`--json` 的 register 值是**字串**，不是 number（編譯器 1.14.0）。
uint64 過不了 JSON number：`18446744073709551615` 用 `JSON.parse` 讀回來是
`18446744073709552000`。所以 `assist.js` 裡那些值從頭到尾不轉成 `Number`，
`tools/assist-check.mjs` 有一條就在盯這件事。
寬度也從判決拿，因為 `widen` 會改它。

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
