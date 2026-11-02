$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $projectRoot '.cache\k6'
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$version = 'v2.3.0'
$archiveName = "k6-$version-windows-amd64.zip"
$archivePath = Join-Path $installRoot $archiveName
$checksumPath = Join-Path $installRoot 'checksums.txt'
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/grafana/k6/releases/download/$version/$archiveName" -OutFile $archivePath
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/grafana/k6/releases/download/$version/k6-$version-checksums.txt" -OutFile $checksumPath
$entry = Get-Content -LiteralPath $checksumPath | Where-Object { $_ -match ([regex]::Escape($archiveName) + '$') }
if (-not $entry) { throw 'Official k6 checksum unavailable. Installation stopped.' }
$expected = ($entry -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($actual.ToLowerInvariant() -ne $expected.ToLowerInvariant()) { throw 'k6 checksum mismatch. Installation stopped.' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $installRoot -Force
$extracted = Join-Path $installRoot "k6-$version-windows-amd64\k6.exe"
if (-not (Test-Path -LiteralPath $extracted)) { throw 'Verified archive did not contain the expected executable.' }
Copy-Item -LiteralPath $extracted -Destination (Join-Path $installRoot 'k6.exe') -Force
Write-Output 'Official k6 archive SHA-256 verified.'
& (Join-Path $installRoot 'k6.exe') version
if ($LASTEXITCODE -ne 0) { throw 'k6 executable verification failed.' }
