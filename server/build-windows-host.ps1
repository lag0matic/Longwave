$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  throw "Missing .venv\\Scripts\\python.exe. Create the server virtual environment first."
}

$python = Resolve-Path ".venv\Scripts\python.exe"

& $python "-m" "pip" "install" "pyinstaller"
& $python "-m" "PyInstaller" "--noconfirm" "windows_host.spec"

Write-Host ""
Write-Host "Build complete:"
Write-Host "  $PSScriptRoot\\dist\\LongwaveServer.exe"
