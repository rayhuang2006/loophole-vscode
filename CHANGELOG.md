# Changelog

## 0.1.0

第一版：`.wish` 和 `.genie` 的語法高亮。

**文法是生成的，不是手寫的。** 哪些字是保留字由編譯器決定——
`loophole --keywords` 從它的 lexer 和 parser 讀的同一張表產生輸出，
隨每個 release 發布成 `keywords.json`，這個套件從那份檔案生成兩份 TextMate 文法。
所以語言長出新的保留字時，這裡不會靜默地停止上色。

- 兩種語言各一份文法，`.wish` 和 `.genie`
- `uint<N>` 的寬度單獨上色——那個數字是整個笑話的來源
- `define` 綁的別名跟真正的操作同色。別名軸就是「名字和它指的東西不是同一件事」，
  編輯器把它顯示成一樣，是在說實話
- `written` 和 `real` 有自己的 scope，因為那兩欄的落差是這個語言的核心
- 註解、字串、括號配對、縮排

用 `vscode-textmate` 和 `vscode-oniguruma`（VS Code 本身的 tokenizer）測試，
不是只驗 JSON 合法——一份文法可以完全合法卻讓每個關鍵字都沒顏色。

行內診斷（紅波浪線）還沒做。
