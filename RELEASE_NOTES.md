# 快剪 QuickCut 2.7.53

## 🚀 全平台封包加固与架构规范化升级

### 1. Windows & macOS 软件封包与运行稳定性全面加固
- **版本号自动同步**：废弃全部硬编码版本，打包脚本自动读取 GitHub Tag 与 `package.json`，确保构建产物文件名、注册表、程序内置状态 100% 统一。
- **构建时序保证**：打包前自动触发 UI 编译，保证最新的前端样式与逻辑完整编入安装包。
- **Windows 启动器增强 (`快剪.exe`)**：增加崩溃捕获与错误提示弹窗，遇到环境缺失或异常时提供友好引导，并可一键启动诊断控制台。
- **macOS Gatekeeper 隔离彻底修复**：
  - 打包时自动清除 `xattr -cr` 隔离属性，深度递归赋予 `chmod -R +x` 执行权限；
  - 执行内部优先的 ad-hoc 递归签名，避免 Mach-O 动态库被 macOS 13+ 误判为“已损坏”；
  - 原生 App 增加本地网络访问权限（App Transport Security），支持权限自愈与 Node/Bun 自动降级寻径。
- **发布产物完整上传**：GitHub Actions 发布流程自动打包并上传 Windows 安装版、Windows 便携版、macOS DMG 安装版、macOS 便携版（中英文命名全部覆盖）。

---

### 2. 代码架构高内聚低耦合规范化重构（100% 保持原有功能）
- **前端模块化重构**：将原 20,700 行单文件拆分为 `styles/`（7 个样式模块）、`html/`（11 个结构模板）、`scripts/`（19 个领域脚本），配合毫秒级构建脚本维护；
- **媒体渲染引擎模块化**：将原 4,600 行 `media.mjs` 拆分为 `core.mjs`、`waveform.mjs`、`denoise.mjs`、`audio-fx.mjs`、`ass.mjs`、`render.mjs`；
- **语音对齐引擎模块化**：将原 2,300 行 `alignment.mjs` 拆分为 `engine.mjs`、`regroup.mjs`、`speech.mjs`。

---

### 3. 达芬奇标准时间线与轨道交互
- **100% 原生轨道头布局**：顶部控制栏置顶，达芬奇原生 Target 徽标，规范化 `视频 1`、`视频 2`、`音频 1` 轨道命名体系；
- **轨道高度无级拖拽**：下边缘自由拖动调节（40px~220px），双击复位，底部音轨自适应保护；
- **8 项时间线核心功能**：标记系统 (`M` / `Shift+M`)、逐帧微移 (`.` / `,`)、合并同源切片、选择跟随播放头、惯性平滑缩放等；
- **交互修复**：音频悬停波形常驻高亮显示，移除修剪时的遮挡放大浮窗，移除时间线末尾多余线条。

---

## 🧪 自动化测试验证
- 全量 **308 项自动化测试 100% 全部通过（0 失败）**。

---

## 📦 发布文件
- Windows 安装版：`QuickCut-Windows-2.7.53-Setup.exe` / `快剪-Windows-2.7.53-安装包.exe`
- Windows 便携版：`QuickCut-Windows-2.7.53-Portable.zip` / `快剪-Windows-2.7.53-测试包.zip`
- macOS 安装版：`QuickCut-macOS-2.7.53-Installer.dmg` / `快剪-macOS-2.7.53-安装包.dmg`
- macOS 便携版：`QuickCut-macOS-2.7.53-Portable.zip` / `快剪-macOS-2.7.53-测试包.zip`
