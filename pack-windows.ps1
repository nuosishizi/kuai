param(
  [string]$OutDir = ""
)
#Requires -Version 5.1
$ErrorActionPreference = "Stop"
try { chcp 65001 > $null } catch {}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageJsonPath = Join-Path $ProjectRoot "Modules\EditorRuntime\editor-desktop\package.json"
$Version = if ($env:GITHUB_REF_NAME -match '^v?(\d+\.\d+\.\d+.*)') {
  $Matches[1]
} elseif (Test-Path $PackageJsonPath) {
  (Get-Content $PackageJsonPath -Raw | ConvertFrom-Json).version
} else {
  "2.7.52"
}

$AppName = "QuickCut-Windows-$Version"
$StageRoot = Join-Path $ProjectRoot "dist-local\pack-stage-windows"
$Stage = Join-Path $StageRoot $AppName
$Cache = Join-Path $StageRoot "cache"
$desktop = [Environment]::GetFolderPath("Desktop")
$fallbackDir = if ($desktop -and (Test-Path $desktop)) { $desktop } else { $ProjectRoot }
$TargetDir = if ($OutDir) {
  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
  (Resolve-Path $OutDir).Path
} else {
  $fallbackDir
}
$ZipPath = Join-Path $TargetDir "快剪-Windows-$Version-测试包.zip"
$NodeVersion = "22.18.0"
$NodeZipName = "node-v$NodeVersion-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeZipName"
$LocalFfmpegBin = "C:\ffmpeg-master-latest-win64-gpl-shared\bin"

function Info([string]$Message) { Write-Host $Message -ForegroundColor Cyan }
function Fail([string]$Message) { Write-Host $Message -ForegroundColor Red; exit 1 }

function Download-File([string]$Url, [string]$Destination) {
  if (Test-Path $Destination) {
    Info "Using cached $(Split-Path $Destination -Leaf)"
    return
  }
  Info "Downloading $Url"
  $partial = "$Destination.partial"
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --fail --retry 3 --retry-delay 2 -o $partial $Url
    if ($LASTEXITCODE -ne 0) { Fail "Download failed: $Url" }
  } else {
    Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing
  }
  Move-Item -Force $partial $Destination
}

New-Item -ItemType Directory -Force -Path $Cache | Out-Null
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$EditorSrc = Join-Path $ProjectRoot "Modules\EditorRuntime\editor-desktop"
$EditorDst = Join-Path $Stage "Modules\EditorRuntime\editor-desktop"
$MediaDst = Join-Path $Stage "Modules\EditorRuntime\media"
New-Item -ItemType Directory -Force -Path $EditorDst | Out-Null
New-Item -ItemType Directory -Force -Path $MediaDst | Out-Null

Info "Pre-building editor UI bundle..."
$BuildScript = Join-Path $EditorSrc "src\ui\build.mjs"
if (Test-Path $BuildScript) {
  & node $BuildScript
}

Info "Copying editor..."
Copy-Item (Join-Path $EditorSrc "package.json") $EditorDst
if (Test-Path (Join-Path $EditorSrc "README-使用说明.txt")) {
  Copy-Item (Join-Path $EditorSrc "README-使用说明.txt") $EditorDst
}
Copy-Item -Recurse (Join-Path $EditorSrc "src") (Join-Path $EditorDst "src")
if (Test-Path (Join-Path $EditorSrc "assets")) {
  Copy-Item -Recurse (Join-Path $EditorSrc "assets") (Join-Path $EditorDst "assets")
}

Info "Copying Windows FFmpeg..."
$foundFfmpeg = $false
if (Test-Path (Join-Path $LocalFfmpegBin "ffmpeg.exe")) {
  Get-ChildItem $LocalFfmpegBin -File | Where-Object { $_.Name -ne "ffplay.exe" } | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $MediaDst $_.Name)
  }
  $foundFfmpeg = $true
}
if (-not $foundFfmpeg) {
  # Do not copy `Get-Command ffmpeg.exe` here. Chocolatey exposes a small
  # machine-local shim that works on the CI runner but becomes an unusable
  # 392 KB executable after it is copied to another computer. Always fetch a
  # self-contained build when the verified local bundle is unavailable.
  Info "Fetching Gyan Windows FFmpeg essentials build..."
  $ffmpegZip = Join-Path $Cache "ffmpeg-release-essentials.zip"
  Download-File "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" $ffmpegZip
  Expand-Archive -Path $ffmpegZip -DestinationPath $Cache -Force
  $extractedBin = (Get-ChildItem $Cache -Directory -Filter "ffmpeg-*-essentials_build" | Select-Object -First 1)
  if ($extractedBin) {
    Get-ChildItem (Join-Path $extractedBin.FullName "bin") -File | Where-Object { $_.Name -ne "ffplay.exe" } | ForEach-Object {
      Copy-Item $_.FullName (Join-Path $MediaDst $_.Name)
    }
    $foundFfmpeg = $true
  }
}
if (-not (Test-Path (Join-Path $MediaDst "ffmpeg.exe")) -or -not (Test-Path (Join-Path $MediaDst "ffprobe.exe"))) {
  Fail "Could not locate or obtain FFmpeg binaries for Windows."
}

# Test the exact bytes that will be shipped, not the FFmpeg available on PATH.
# A dynamic build is valid only when its DLLs are beside it; a tiny executable
# with no DLLs is almost certainly a package-manager shim.
$PackagedFfmpeg = Join-Path $MediaDst "ffmpeg.exe"
$PackagedFfprobe = Join-Path $MediaDst "ffprobe.exe"
$PackagedDlls = @(Get-ChildItem -LiteralPath $MediaDst -File -Filter "*.dll")
if ((Get-Item -LiteralPath $PackagedFfmpeg).Length -lt 1MB -and $PackagedDlls.Count -eq 0) {
  Fail "Packaged FFmpeg is an incomplete shim: $PackagedFfmpeg"
}
& $PackagedFfmpeg -hide_banner -version *> $null
if ($LASTEXITCODE -ne 0) { Fail "Packaged FFmpeg cannot start outside the build environment." }
& $PackagedFfprobe -hide_banner -version *> $null
if ($LASTEXITCODE -ne 0) { Fail "Packaged FFprobe cannot start outside the build environment." }
$PackagedFilters = (& $PackagedFfmpeg -hide_banner -filters 2>&1) -join "`n"
foreach ($RequiredFilter in @("afftdn", "arnndn", "crystalizer", "deesser")) {
  if ($PackagedFilters -notmatch "\b$RequiredFilter\b") {
    Fail "Packaged FFmpeg is missing required audio filter: $RequiredFilter"
  }
}
$MediaSmoke = Join-Path $StageRoot "packaged-ffmpeg-smoke.m4a"
& $PackagedFfmpeg -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=0.4" -af "afftdn=nr=10:nf=-42,alimiter=limit=0.97" -c:a aac -b:a 128k $MediaSmoke
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $MediaSmoke) -or (Get-Item $MediaSmoke).Length -lt 1024) {
  Fail "Packaged FFmpeg failed the real audio render smoke test."
}
Remove-Item -LiteralPath $MediaSmoke -Force
$LocalMedia = Join-Path $ProjectRoot "Modules\EditorRuntime\media"
if (Test-Path $LocalMedia) {
  Get-ChildItem $LocalMedia -File | Where-Object {
    $_.Name -match "deepfilter|deep-filter"
  } | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $MediaDst $_.Name)
  }
}

Info "Preparing portable Node.js $NodeVersion..."
$NodeZip = Join-Path $Cache $NodeZipName
Download-File $NodeUrl $NodeZip
$NodeExtract = Join-Path $Cache "node-v$NodeVersion-win-x64"
if (-not (Test-Path (Join-Path $NodeExtract "node.exe"))) {
  if (Test-Path $NodeExtract) { Remove-Item -Recurse -Force $NodeExtract }
  Expand-Archive -Path $NodeZip -DestinationPath $Cache -Force
}
$RuntimeNode = Join-Path $Stage "runtime\node"
New-Item -ItemType Directory -Force -Path $RuntimeNode | Out-Null
Copy-Item (Join-Path $NodeExtract "node.exe") (Join-Path $RuntimeNode "node.exe")
Get-ChildItem $NodeExtract -File -Filter "*.dll" | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $RuntimeNode $_.Name)
}

$Launcher = @"
@echo off
setlocal
cd /d "%~dp0"
title QuickCut $Version
set "QUICKCUT_MEDIA_ROOT=%~dp0Modules\EditorRuntime\media"
set "PATH=%~dp0runtime\node;%QUICKCUT_MEDIA_ROOT%;%PATH%"
if not exist "%~dp0runtime\node\node.exe" (
  echo 缺少内置 Node.js 运行环境。
  pause
  exit /b 1
)
if not exist "%QUICKCUT_MEDIA_ROOT%\ffmpeg.exe" (
  echo 缺少内置 FFmpeg 媒体组件。
  pause
  exit /b 1
)
echo 正在启动快剪 QuickCut $Version ...
cd /d "%~dp0Modules\EditorRuntime\editor-desktop"
"%~dp0runtime\node\node.exe" "src\main.mjs"
if errorlevel 1 (
  echo.
  echo 快剪运行出现异常，已退出。
  pause
)
endlocal
"@
Set-Content -Path (Join-Path $Stage "启动快剪.bat") -Value $Launcher -Encoding OEM

$Readme = @"
快剪 QuickCut $Version  Windows 运行说明

系统要求
- Windows 10 / 11 64 位
- 已安装 Microsoft Edge（系统自带）
- 不需要单独安装 Node.js 或 FFmpeg

使用方式
1. 解压整个文件夹（或直接使用安装程序安装）。
2. 双击「快剪.exe」或「启动快剪.bat」。
3. 如果 SmartScreen 拦截，选「更多信息」→「仍要运行」。
4. 关掉编辑器窗口即退出。

功能亮点
- 视频/音频智能停顿剪切与文稿对齐；
- 7 段专业级人声降噪与工频 50/60Hz 嗡声消除；
- 达芬奇 Resolve 5 步时序无损导出与实时联动；
- ASS 贝塞尔三次圆角字幕排版与逐字高亮。

说明
- 工程数据保存在当前 Windows 用户的 %APPDATA%\QuickCut。
- 本包不含任何第三方 API Key，也不包含素材文件。
"@
Set-Content -Path (Join-Path $Stage "使用说明.txt") -Value $Readme -Encoding UTF8

Info "Compiling enhanced native Windows GUI launcher (快剪.exe)..."
$launcherCode = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using System.Threading;

namespace QuickCutLauncher {
    public class Program {
        [STAThread]
        public static void Main() {
            try {
                string appDir = AppDomain.CurrentDomain.BaseDirectory;
                string nodeExe = Path.Combine(appDir, "runtime", "node", "node.exe");
                if (!File.Exists(nodeExe)) {
                    nodeExe = "node.exe";
                }
                string script = Path.Combine(appDir, "Modules", "EditorRuntime", "editor-desktop", "src", "main.mjs");
                string mediaDir = Path.Combine(appDir, "Modules", "EditorRuntime", "media");

                if (!File.Exists(nodeExe) && !File.Exists(Path.Combine(appDir, "runtime", "node", "node.exe"))) {
                    MessageBox.Show("找不到内置运行组件 runtime\\node\\node.exe，请确认完整解压了安装包。", "快剪 QuickCut", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
                if (!File.Exists(script)) {
                    MessageBox.Show("找不到主程序文件：\n" + script, "快剪 QuickCut", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodeExe;
                psi.Arguments = "\"" + script + "\"";
                psi.WorkingDirectory = Path.Combine(appDir, "Modules", "EditorRuntime", "editor-desktop");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardError = true;
                psi.EnvironmentVariables["QUICKCUT_MEDIA_ROOT"] = mediaDir;

                Process proc = Process.Start(psi);
                if (proc == null) {
                    MessageBox.Show("无法启动后台服务进程。", "快剪 QuickCut", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                // Monitor initial 2.5 seconds to detect immediate startup crash
                bool exitedEarly = proc.WaitForExit(2500);
                if (exitedEarly && proc.ExitCode != 0) {
                    string errorOut = proc.StandardError.ReadToEnd();
                    string msg = "快剪后台服务启动异常 (退出码 " + proc.ExitCode + ")。\n\n" +
                                 (string.IsNullOrEmpty(errorOut) ? "请双击运行「启动快剪.bat」查看控制台详细报错。" : errorOut);
                    DialogResult result = MessageBox.Show(msg + "\n\n是否立即以命令行诊断模式启动？", "快剪 QuickCut", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                    if (result == DialogResult.Yes) {
                        string batPath = Path.Combine(appDir, "启动快剪.bat");
                        if (File.Exists(batPath)) {
                            Process.Start(new ProcessStartInfo(batPath) { UseShellExecute = true });
                        }
                    }
                }
            } catch (Exception ex) {
                MessageBox.Show("启动快剪遇到异常: " + ex.Message, "快剪 QuickCut", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
"@
$launcherExe = Join-Path $Stage "快剪.exe"
$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $cscPath)) {
  $cscPath = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (Test-Path $cscPath) {
  $tempCs = Join-Path $StageRoot "Launcher.cs"
  Set-Content -Path $tempCs -Value $launcherCode -Encoding UTF8
  & $cscPath /nologo /target:winexe /out:"$launcherExe" /reference:System.Windows.Forms.dll "$tempCs"
  Remove-Item -Force $tempCs -ErrorAction SilentlyContinue
} else {
  try {
    Add-Type -TypeDefinition $launcherCode -Language CSharp -OutputAssembly $launcherExe -OutputType WindowsApplication -ReferencedAssemblies "System.Windows.Forms.dll"
  } catch {}
}

# Build Inno Setup Installer if compiler is present
$isccCmd = Get-Command iscc.exe -ErrorAction SilentlyContinue
$iscc = if ($isccCmd) { $isccCmd.Source } else { $null }
if (-not $iscc) {
  $candidatePaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  )
  foreach ($p in $candidatePaths) {
    if (Test-Path $p) { $iscc = $p; break }
  }
}
if ($iscc) {
  Info "Building Inno Setup Windows installer with $iscc..."
  $issFile = Join-Path $ProjectRoot "installer.iss"
  & $iscc "/DMyAppVersion=$Version" "/DSourceDir=$Stage" "/O$TargetDir" $issFile
  if ($LASTEXITCODE -eq 0) {
    $setupExe = Join-Path $TargetDir "QuickCut-Windows-$Version-Setup.exe"
    $chineseExe = Join-Path $TargetDir "快剪-Windows-$Version-安装包.exe"
    if (Test-Path $setupExe) {
      Copy-Item $setupExe $chineseExe -Force
      $instItem = Get-Item $chineseExe
      Info ("Installer: {0}  ({1:N1} MB)" -f $instItem.FullName, ($instItem.Length / 1MB))
    }
  }
}

if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Info "Creating $ZipPath"
Compress-Archive -Path $Stage -DestinationPath $ZipPath -Force
$PortableZip = Join-Path $TargetDir "QuickCut-Windows-$Version-Portable.zip"
Copy-Item $ZipPath $PortableZip -Force

$zip = Get-Item $ZipPath
Info ""
Info "Done."
Info "Folder: $Stage"
Info ("Zip:    {0}  ({1:N1} MB)" -f $zip.FullName, ($zip.Length / 1MB))
