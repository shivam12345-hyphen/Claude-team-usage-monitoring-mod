# Claude Code usage tracker setup (Windows PowerShell).
$endpoint = "https://claudeusage-mocha.vercel.app"
$sec = Read-Host "Your personal token (sent to you privately)" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if (-not $token) { Write-Host "Token cannot be empty"; exit 1 }
$dir = Join-Path $env:USERPROFILE ".claude"; New-Item -ItemType Directory -Force $dir | Out-Null
$p = Join-Path $dir "settings.json"
$d = @{}
if (Test-Path $p) {
  try { $d = Get-Content $p -Raw | ConvertFrom-Json -AsHashtable } catch { Write-Host "settings.json is not valid JSON; fix it first (nothing changed)."; exit 1 }
}
if (-not $d) { $d = @{} }
if (-not $d.ContainsKey("env")) { $d["env"] = @{} }
$d["env"]["CLAUDE_CODE_ENABLE_TELEMETRY"] = "1"
$d["env"]["OTEL_METRICS_EXPORTER"] = "otlp"
$d["env"]["OTEL_EXPORTER_OTLP_PROTOCOL"] = "http/json"
$d["env"]["OTEL_EXPORTER_OTLP_ENDPOINT"] = $endpoint
$d["env"]["OTEL_EXPORTER_OTLP_HEADERS"] = "Authorization=Bearer $token"
$d["env"].Remove("OTEL_RESOURCE_ATTRIBUTES")
$d | ConvertTo-Json -Depth 10 | Set-Content $p
Write-Host "Done. Set up. Fully quit and reopen Claude Code."
