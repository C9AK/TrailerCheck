# UGL Trailer Check — bootstrap + launch (Windows PowerShell 5.1 compatible).
# Idempotent: safe to re-run any time; it restarts the app cleanly.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

# ── Python ──────────────────────────────────────────────────────────────
function Find-Python {
    foreach ($cand in @("python", "python3", "py")) {
        $cmd = Get-Command $cand -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source -notlike "*WindowsApps*") {
            try {
                $v = & $cmd.Source --version 2>&1
                if ("$v" -match "Python 3") { return $cmd.Source }
            } catch {}
        }
    }
    return $null
}

$python = Find-Python
if (-not $python) {
    Write-Step "Python not found - installing via winget (accept the UAC prompt)..."
    winget install Python.Python.3.12 --accept-source-agreements --accept-package-agreements --silent
    Refresh-Path
    $python = Find-Python
    if (-not $python) { throw "Python install failed. Install Python 3.12+ manually, then re-run run.bat." }
}
Write-Step "Python: $python"

# ── Node.js ─────────────────────────────────────────────────────────────
function Find-NodeDir {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return (Split-Path $cmd.Source) }
    if (Test-Path "$env:ProgramFiles\nodejs\node.exe") { return "$env:ProgramFiles\nodejs" }
    return $null
}

$nodeDir = Find-NodeDir
if (-not $nodeDir) {
    Write-Step "Node.js not found - installing via winget (accept the UAC prompt)..."
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
    Refresh-Path
    $nodeDir = Find-NodeDir
    if (-not $nodeDir) { throw "Node.js install failed. Install Node LTS manually, then re-run run.bat." }
}
$env:Path = "$nodeDir;$env:Path"
Write-Step "Node.js: $nodeDir"

# ── Stop anything already on our ports (clean restart) ─────────────────
$owners = @()
foreach ($port in 3000, 8000) {
    $owners += (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
}
foreach ($procId in ($owners | Where-Object { $_ } | Sort-Object -Unique)) {
    try { Stop-Process -Id $procId -Force -Confirm:$false } catch {}
}

# ── Backend setup ───────────────────────────────────────────────────────
$venvPy = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Step "Creating Python virtual environment..."
    & $python -m venv (Join-Path $Root "backend\.venv")
}
Write-Step "Installing backend dependencies..."
& $venvPy -m pip install -q -r (Join-Path $Root "backend\requirements.txt")

if (-not (Test-Path (Join-Path $Root "backend\mc_tokens.json"))) {
    Write-Warn "backend\mc_tokens.json not found - telemetry will use MOCK data."
    Write-Warn "Copy the real file from another machine (it is never in git)."
}

Write-Step "Preparing database (seed is idempotent)..."
Push-Location (Join-Path $Root "backend")
$env:DATABASE_URL = "sqlite:///./dev.db"
& $venvPy -m app.scripts.migrate_r8 | Out-Null
& $venvPy -m app.scripts.seed
Pop-Location

# ── Frontend setup (auto-detects this machine's LAN IP) ────────────────
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.1[6-9].*" -or $_.IPAddress -like "172.2*.*" -or $_.IPAddress -like "172.3[01].*" } |
    Select-Object -First 1).IPAddress
if (-not $ip) { $ip = "localhost" }

$envFile = Join-Path $Root "frontend\.env.local"
$desired = "NEXT_PUBLIC_API_URL=http://${ip}:8000"
$needBuild = -not (Test-Path (Join-Path $Root "frontend\.next"))
$current = ""
if (Test-Path $envFile) { $current = (Get-Content $envFile -Raw).Trim() }
if ($current -ne $desired) {
    Write-Step "Pointing frontend at this machine's API: http://${ip}:8000"
    [System.IO.File]::WriteAllText($envFile, $desired + "`n")
    $needBuild = $true   # the API URL is baked in at build time
}

Push-Location (Join-Path $Root "frontend")
if (-not (Test-Path "node_modules")) {
    Write-Step "Installing frontend dependencies (first run only, ~1 min)..."
    & "$nodeDir\npm.cmd" install --no-fund --no-audit
}
if ($needBuild) {
    Write-Step "Building frontend (first run / IP change only, ~1 min)..."
    & "$nodeDir\npm.cmd" run build
}
Pop-Location

# ── Firewall (best effort - needs admin; skipped silently otherwise) ───
try {
    if (-not (Get-NetFirewallRule -DisplayName "TrailerCheck Frontend 3000" -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName "TrailerCheck Frontend 3000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private | Out-Null
        New-NetFirewallRule -DisplayName "TrailerCheck Backend 8000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Private | Out-Null
        Write-Step "Firewall rules added."
    }
} catch {
    Write-Warn "Could not add firewall rules (not admin). For Wi-Fi access, run run.bat once as Administrator."
}

# ── Launch ──────────────────────────────────────────────────────────────
Write-Step "Starting servers..."
$backendArgs = "/k title TrailerCheck Backend && cd /d ""$Root\backend"" && set DATABASE_URL=sqlite:///./dev.db && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
Start-Process cmd -ArgumentList $backendArgs
$frontendArgs = "/k title TrailerCheck Frontend && cd /d ""$Root\frontend"" && set PATH=$nodeDir;%PATH% && npm run start -- -H 0.0.0.0"
Start-Process cmd -ArgumentList $frontendArgs

Start-Sleep -Seconds 6
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host " UGL Trailer Check is running" -ForegroundColor Green
Write-Host "   This machine:  http://localhost:3000"
Write-Host "   Same Wi-Fi:    http://${ip}:3000"
Write-Host " Close the two console windows to stop it."
Write-Host "===============================================" -ForegroundColor Green
