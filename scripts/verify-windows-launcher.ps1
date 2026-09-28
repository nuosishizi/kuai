param([Parameter(Mandatory=$true)][string]$AppDir)
$ErrorActionPreference = 'Stop'
$env:QUICKCUT_NO_WINDOW = '1'
$env:QUICKCUT_SUPPORT_ROOT = Join-Path $env:TEMP ([guid]::NewGuid().ToString())
$launcher = Start-Process -FilePath (Join-Path $AppDir '快剪.exe') -PassThru -WindowStyle Hidden
$backend = $null
try {
  $deadline = (Get-Date).AddSeconds(40)
  do {
    Start-Sleep -Milliseconds 400
    $backend = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($launcher.Id)" | Where-Object { $_.Name -eq 'node.exe' } | Select-Object -First 1
    if ($launcher.HasExited) { throw 'Native launcher exited before readiness' }
  } until ($backend -or (Get-Date) -gt $deadline)
  if (-not $backend) { throw 'Native launcher did not start its bundled Node.js' }
  do {
    Start-Sleep -Milliseconds 400
    $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $backend.ProcessId -and $_.LocalAddress -eq '127.0.0.1' } | Select-Object -First 1
  } until ($listener -or (Get-Date) -gt $deadline)
  if (-not $listener) { throw 'Native launcher backend did not listen' }
  $health = Invoke-RestMethod "http://127.0.0.1:$($listener.LocalPort)/health" -TimeoutSec 10
  if (-not $health.ok) { throw 'Native launcher health check failed' }
  Write-Host "Native Windows launcher verified: $($health.version)"
} finally {
  if ($backend) { Stop-Process -Id $backend.ProcessId -Force -ErrorAction SilentlyContinue }
  if (-not $launcher.HasExited) { Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue }
}
