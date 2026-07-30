# Loophole for VS Code

`.wish` 和 `.genie` 的語法高亮。

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

- 兩種語言的語法高亮
- 註解（`#`）、括號配對、大括號自動縮排
- `uint<N>` 的**寬度單獨上色**——那個數字是整個笑話的來源
- `define` 綁的別名跟真正的操作同色，因為它就是同一件事

**保留字不是手寫的清單。** 它從編譯器的 `loophole --keywords` 生成，
所以語言長出新的字時，這裡不會悄悄落後。

## 裝

還沒上架。自己打包：

```bash
npm install
npx @vscode/vsce package
code --install-extension loophole-0.1.0.vsix
```

## 要編譯器本身

```bash
curl -L -o loophole https://github.com/rayhuang2006/Loophole/releases/latest/download/loophole-macos-arm64
chmod +x loophole && sudo mv loophole /usr/local/bin/
```

Linux 換成 `loophole-linux-x86_64`。或者 `git clone` 之後 `make`——
一個 C++ 檔案，沒有任何相依。

## 還沒做

**行內診斷**（紅色波浪線）。編譯器已經有 WebAssembly 版本，
套件可以呼叫它把錯誤變成波浪線。

## 授權

MIT。改這個套件請看 [CONTRIBUTING.md](CONTRIBUTING.md)。
