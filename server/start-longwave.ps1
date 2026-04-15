$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  throw "Missing .venv\\Scripts\\python.exe. Create a virtual environment and install server requirements first."
}

$python = Resolve-Path ".venv\Scripts\python.exe"

& $python "-m" "alembic" "upgrade" "head"

$hostValue = if ($env:HOST) { $env:HOST } else { "0.0.0.0" }
$portValue = if ($env:PORT) { $env:PORT } else { "8000" }
$logLevel = if ($env:LOG_LEVEL) { $env:LOG_LEVEL } else { "info" }
$sslCertFile = if ($env:SSL_CERTFILE) { $env:SSL_CERTFILE } else { $null }
$sslKeyFile = if ($env:SSL_KEYFILE) { $env:SSL_KEYFILE } else { $null }

$uvicornArgs = @("-m", "uvicorn", "app.main:app", "--host", $hostValue, "--port", $portValue, "--proxy-headers", "--log-level", $logLevel)

if (($sslCertFile -and -not $sslKeyFile) -or ($sslKeyFile -and -not $sslCertFile)) {
  throw "HTTPS requires both SSL_CERTFILE and SSL_KEYFILE."
}

if ($sslCertFile -and $sslKeyFile) {
  $uvicornArgs += @("--ssl-certfile", $sslCertFile, "--ssl-keyfile", $sslKeyFile)
}

& $python @uvicornArgs
