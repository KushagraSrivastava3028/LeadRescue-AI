$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$scanner = Get-Command gitleaks -ErrorAction SilentlyContinue
if ($scanner) { $scannerPath = $scanner.Source } else { $scannerPath = Join-Path $projectRoot '.cache\gitleaks\gitleaks.exe' }
if (-not (Test-Path -LiteralPath $scannerPath)) { throw 'Install Gitleaks from its official release and verify its checksum. No secret scan was performed.' }
& $scannerPath dir . --redact=100 --no-banner --log-level=warn
if ($LASTEXITCODE -ne 0) { throw 'Redacted source/build secret scanning failed. Review findings without printing credential values.' }
if (Test-Path -LiteralPath (Join-Path $projectRoot '.git')) {
  $commitCount = & git rev-list --all --count
  if ($LASTEXITCODE -eq 0 -and [int]$commitCount -gt 0) {
    & $scannerPath git . --redact=100 --no-banner --log-level=warn '--log-opts=--all'
    if ($LASTEXITCODE -ne 0) { throw 'Redacted Git-history secret scanning failed.' }
  } else { Write-Output 'Git has no commits; history scan is not applicable yet.' }
} else { Write-Output 'No Git repository exists; previous Git history was not available to scan.' }
Write-Output 'Redacted secret scan completed for eligible project source and build artifacts.'
