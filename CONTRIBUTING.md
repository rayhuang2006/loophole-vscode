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

`npm test` 跑的是 **`vscode-textmate` + `vscode-oniguruma`——VS Code 本身用的
tokenizer**，不是只驗 JSON 合法。因為一份文法可以完全合法、卻讓每個關鍵字都沒顏色。

三個性質：

1. **`keywords.json` 裡的每一個字都必須被上色。**
   字表沒有在測試裡重打一遍，所以編譯器多一個保留字而文法漏掉時會直接失敗，
   沒有 fixture 要跟著更新。
2. **關鍵字不能匹配到更長的識別字裡面。**
   `invariant` 裡的 `in`、`really` 裡的 `real`、`format` 裡的 `format`——
   這是生成的 alternation 最典型的壞法，而且在有人把暫存器命名成 `format`
   之前都看不出來。
3. 註解、字串、`uint<N>` 的寬度、願望名、規則名的 scope 是否如預期。

CI 另外做兩件事：確認 `syntaxes/` 就是生成器的產物，
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

想加行內診斷的話，注意它跟高亮完全無關，而且**誰也取代不了誰**：

- **上色**跑在每一次按鍵之後，看到的檔案九成時間是打到一半的、壞的。
  它絕對不能放棄。
- **編譯器的 parser** 遇到壞檔案的職責是**拒絕**——那不是缺點，那是它的工作。

所以診斷要另外呼叫編譯器的 WebAssembly 版本拿 `--json`，
不能拿它來上色。VS Code 幫 C++ 上色時也不是叫 clang。

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
