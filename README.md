# Loophole for VS Code

`.wish` 和 `.genie` 的語法高亮，以及行內診斷。

## Loophole 是什麼

一個工程師笑話，被當成技術規格認真對待。

精靈說「你有三個願望」。工程師說：**「我許願，扣掉我三個願望。」**
願望數存在一個兩位元的格子裡，沒有負數這種東西——於是它繞回最大值。

> 「已實現。您現在還有三個願望。」

[Loophole](https://github.com/rayhuang2006/Loophole) 是一個編譯器，
把那個笑話變成機器可以驗證的東西。它讀兩種語言：

| | 誰寫的 | 裡面有什麼 |
| --- | --- | --- |
| `.wish` | 許願的人 | 一個世界，和在裡面許的願望 |
| `.genie` | 精靈 | 它禁什麼，以及它以為自己守著什麼 |

**不用裝任何東西就能試**——[線上有二十八章的課程](https://rayhuang2006.github.io/Loophole/)，
編譯器跑在你的瀏覽器裡。

## 這個套件做什麼

**語法高亮**

- 兩種語言都上色，註解（`#`）、括號配對、大括號自動縮排
- `uint<N>` 的**寬度單獨上色**——那個數字是整個笑話的來源
- `define` 綁的別名跟真正的操作同色，因為它就是同一件事

**行內診斷**——套件內含編譯器本體（WebAssembly），所以判決來自編譯器自己，
不是另外寫一套規則。你打字的時候它就在判。

| | 顯示成 |
| --- | --- |
| 讀不懂這個檔案 | **錯誤**。什麼都沒被判，這是唯一真正的問題 |
| 精靈拒絕了這個願望 | 提示，附上是哪條規則擋的 |
| `EXPLOIT`——合規卻拆穿了 | 提示，附上破了哪幾條不變量 |
| 什麼都沒破 | 不顯示 |

**破掉不變量不算錯誤，這是刻意的。** 在這個語言裡，寫出一個合規卻拆穿精靈的願望
就是你的目標。把它算進錯誤數，等於編輯器在騙你說你做壞了。
所以左下角那個紅色數字只數一件事：編譯器讀不懂的檔案。

`.wish` 開頭寫 `# genie: mine.genie` 就會用那個精靈來判（跟編譯器的
`make run` 同一個慣例），沒寫就用內建的。那個檔案還沒存檔也算——
編輯精靈的時候，願望那邊的波浪線會跟著動。

## 裝

在 VS Code 的擴充套件裡搜 **Loophole**，或者：

```bash
code --install-extension rayhuang2006.loophole
```

## 要編譯器本身

套件裡的編譯器只判你正在編輯的檔案。要在終端機跑（`--hunt` 讓機器自己去找洞、
批次判整個資料夾）就裝本體：

```bash
curl -L -o loophole https://github.com/rayhuang2006/Loophole/releases/latest/download/loophole-macos-arm64
chmod +x loophole && sudo mv loophole /usr/local/bin/
```

Linux 換成 `loophole-linux-x86_64`。或者 `git clone` 之後 `make`——
一個 C++ 檔案，沒有任何相依。

## 授權

MIT。改這個套件請看 [CONTRIBUTING.md](CONTRIBUTING.md)。
