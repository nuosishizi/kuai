param([string]$OutDir = "dist")
$ErrorActionPreference = "Stop"
if (-not $IsMacOS) { throw "macOS application bundles must be built and tested on macOS." }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
# Native tools preserve Mach-O signatures, app symlinks and executable permissions.
# FFmpeg relocation is handled by scripts/bundle-media-deps.sh.
& /bin/bash (Join-Path $root "scripts/package-macos.sh") $OutDir
if ($LASTEXITCODE -ne 0) { throw "macOS packaging failed with exit code $LASTEXITCODE" }
