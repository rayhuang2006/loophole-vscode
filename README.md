# Loophole for VS Code

`.wish` 和 `.genie` 的語法高亮。

[Loophole](https://github.com/rayhuang2006/Loophole) 是一個編譯器，它讀兩種語言：
`.wish` 是許願的人寫的，`.genie` 是精靈寫的規矩。整個專案是把一個工程師笑話
當成一份技術規格認真對待——[線上有二十八章的課程](https://rayhuang2006.github.io/Loophole/)。

## 裝

還沒上架。目前要自己打包：

```bash
npm install
npx @vscode/vsce package
code --install-extension loophole-0.1.0.vsix
```

## 這裡沒有關鍵字清單

**文法是生成的，不是手寫的。**

哪些字是保留字，是編譯器決定的——`loophole --keywords` 從它的 lexer 和 parser
讀的同一張表產生輸出，而那份輸出隨每個 release 發布成 `keywords.json`。
這個 repo 抓那份檔案，生成兩份 TextMate 文法：

```
loophole --keywords          （上游，唯一來源）
        ↓  release 附 keywords.json
tools/keywords.json          （抓下來，進版控）
        ↓  tools/gen-grammars.mjs
syntaxes/*.tmLanguage.json   （生成物，進版控，因為編輯器要讀它）
```

**為什麼不讓編譯器直接生成 TextMate 文法？** 因為 scope 命名（`keyword.control`、
`entity.name.function` 之類）是 VS Code 的詞彙，不是語言的知識。放進編譯器的話，
以後多支援一個編輯器就要改編譯器一次。**上游吐資料，下游決定格式。**

```bash
npm run keywords   # 從最新 release 更新字表
npm run gen        # 重新生成兩份文法
npm test           # 用 VS Code 自己的 tokenizer 驗
npm run check      # 以上全部 + 確認沒有人手改生成物
```

## 測的是什麼

`npm test` 跑的是 **`vscode-textmate` + `vscode-oniguruma`——VS Code 本身用的
tokenizer**，不是只驗 JSON 合法。因為一份文法可以完全合法卻讓每個關鍵字都沒顏色。

三件事：

1. **`keywords.json` 裡的每一個字都必須被上色。** 字表沒有在測試裡重打一遍，
   所以編譯器多一個保留字而文法漏掉時，會直接失敗——沒有 fixture 要跟著更新。
2. **關鍵字不能匹配到更長的識別字裡面。** `invariant` 裡的 `in`、`really` 裡的
   `real`、`format` 裡的 `format`——這是生成的 alternation 最典型的壞法，
   而且在有人把暫存器命名成 `format` 之前都看不出來。
3. 註解、字串、`uint<N>` 的寬度、願望名、規則名的 scope 是否如預期。

CI 另外做兩件事：確認 `syntaxes/` 就是生成器的產物（沒人手改過），
以及每週檢查上游有沒有新的保留字。

## 顏色怎麼分

| | 上色成 |
| --- | --- |
| `register` `attribute` `people` `wish` `define` `promise` | `keyword.control` |
| 六個操作 `sub` `add` `widen` `set` `kill` `revive` | `support.function.operation` |
| `uint<N>` | `storage.type` + 寬度另外標 `constant.numeric.width` |
| 願望的名字 | `entity.name.function` |
| `define` 綁的名字 | `support.function.alias` ← 跟真正的操作同一個顏色 |
| 規則／不變量／概念的名字 | `entity.name.type` |
| `surface` `ast` | `constant.language.layer` |
| `written` `real` | `keyword.control.column` |

有兩個是刻意的：

**`define` 綁的別名跟真正的操作同色。** 別名軸就是「名字和它指的東西不是同一件事」——
編輯器把 `mercy` 顯示成跟 `kill` 一樣，是在說實話。

**`written` 和 `real` 有自己的 scope。** 那兩欄的落差是整個語言的核心，
值得讓主題有辦法把它們挑出來。

## 還沒做

行內診斷（紅波浪線）。編譯器已經有 WebAssembly 版本，插件可以呼叫它拿 `--json`，
把錯誤變成波浪線——**上色和診斷是兩個獨立的系統**，上色跑在每次按鍵之後、
必須容忍打到一半的壞檔案，而編譯器遇到壞檔案的職責是拒絕。

## 授權

MIT
