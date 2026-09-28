# QuickCut 2.7.53 · 运行包

Windows：Windows 10/11 x64，使用 Setup.exe 安装，或完整解压 Portable.zip 后双击「快剪.exe」。保留所有子目录；需要系统 Microsoft Edge，无需安装 Node.js、FFmpeg 或开发工具。

macOS：macOS 15 或更高。Apple 芯片选 arm64，Intel 芯片选 x64。打开 DMG，将 QuickCut.app 拖到 Applications，然后打开。ZIP 内是相同的完整 APP，无需 Xcode、Homebrew、Node.js 或 FFmpeg。

本次 macOS 包采用 ad-hoc 签名，未经过 Apple Developer ID 公证。首次打开可能需要在「系统设置 → 隐私与安全性」中允许。如果系统明确提示已损坏且不给允许选项，只对已下载并核对 SHA256SUMS.txt 的该应用执行：

    xattr -dr com.apple.quarantine /Applications/QuickCut.app

此命令仅移除该应用的下载隔离属性，不关闭系统 Gatekeeper。

运行包包含编辑器、JavaScript 运行时及 FFmpeg/FFprobe。语音模型、第三方 API Key 与可选 DeepFilter/Demucs 引擎不属于离线运行包，相关功能仍按应用提示配置或下载。

发布前在各自架构的 GitHub runner 上验证解压后的运行时、媒体编码、ASS 字幕渲染、HTTP 健康检查与项目 RPC；这不等同于在所有用户硬件和操作系统版本上完成测试。
