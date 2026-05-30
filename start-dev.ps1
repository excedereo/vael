Set-Location $PSScriptRoot

# Start Vite in a new window so it uses Windows localhost properly
$vite = Start-Process -FilePath "cmd" -ArgumentList "/c npx vite" -PassThru -NoNewWindow
Write-Host "Vite started (PID $($vite.Id)), waiting for port..."

# Poll TCP ports 5173-5180
$url = $null
$timeout = [DateTime]::Now.AddSeconds(30)

while ([DateTime]::Now -lt $timeout -and -not $url) {
  foreach ($port in 5173..5180) {
    try {
      $tcp = New-Object System.Net.Sockets.TcpClient
      $tcp.Connect("127.0.0.1", $port)
      $tcp.Close()
      $url = "http://localhost:$port"
      Write-Host "Vite detected at $url"
      break
    } catch { }
  }
  if (-not $url) { Start-Sleep -Milliseconds 500 }
}

if (-not $url) {
  Write-Error "Vite did not start in time"
  Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

Write-Host "Building Electron..."
& node electron-build.mjs
if ($LASTEXITCODE -ne 0) {
  Write-Error "Electron build failed"
  Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

Write-Host "Starting Electron at $url ..."
$env:VITE_DEV_SERVER_URL = $url
& electron .

Write-Host "Electron closed, stopping Vite..."
Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
