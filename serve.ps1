# Iron Log - local dev server for phone testing over USB (Android).
#
# What this does:
#   1. Starts a local static file server for this folder.
#   2. Uses `adb reverse` so your Android phone's `localhost:8000` tunnels
#      over the USB cable to this computer's `localhost:8000`.
#   3. Because the phone sees it as "localhost", the service worker (sw.js)
#      registers normally, just like it would on the real deployed site.
#
# One-time setup on your phone:
#   Settings > About phone > tap "Build number" 7 times to unlock Developer options.
#   Settings > Developer options > enable "USB debugging".
#   Plug the phone into this PC via USB, and tap "Allow" on the phone's
#   "Allow USB debugging?" popup when it appears.
#
# Usage:
#   .\serve.ps1
#   Then on the phone, open Chrome and go to:  http://localhost:8000
#   Ctrl+C here stops the server.

$Port = 8000

# adb was just installed via winget; make sure this shell session can see it
# even before a terminal restart picks up the new PATH.
$machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
$userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = "$machinePath;$userPath"

$device = adb devices | Select-String -Pattern "\tdevice$"
if (-not $device) {
    Write-Host "No Android device detected over USB." -ForegroundColor Yellow
    Write-Host "Plug your phone in, enable USB debugging, and accept the prompt on the phone." -ForegroundColor Yellow
    Write-Host "Then re-run this script. Continuing anyway (you can still test in a desktop browser)." -ForegroundColor Yellow
} else {
    adb reverse tcp:$Port tcp:$Port | Out-Null
    Write-Host "adb reverse set up: phone's localhost:$Port -> this PC's localhost:$Port" -ForegroundColor Green
}

Write-Host ""
Write-Host "Serving c:\iron_log at http://localhost:$Port (Ctrl+C to stop)" -ForegroundColor Cyan
Write-Host "On your phone (Chrome): http://localhost:$Port" -ForegroundColor Cyan
Write-Host ""

python -m http.server $Port --bind 127.0.0.1 --directory $PSScriptRoot
