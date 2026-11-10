$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FontPath = Join-Path $ProjectRoot "public\assets\fonts\BLOTUS.TTF"

Write-Host ""
Write-Host "Hamtaraz - B Lotus Font Check" -ForegroundColor Cyan
Write-Host "Expected file: public\assets\fonts\BLOTUS.TTF"
Write-Host ""

if (-not (Test-Path -LiteralPath $FontPath -PathType Leaf)) {
    Write-Host "[NOT FOUND] Font file is missing." -ForegroundColor Red
    Write-Host "Copy BLOTUS.TTF into: $FontPath"
    exit 1
}

$Bytes = [System.IO.File]::ReadAllBytes($FontPath)
if ($Bytes.Length -lt 12) {
    Write-Host "[INVALID] File is too small to be a valid font." -ForegroundColor Red
    exit 1
}

$Signature = ([System.BitConverter]::ToString($Bytes[0..3])).Replace("-", "").ToLowerInvariant()
$ValidSignatures = @("00010000", "4f54544f", "74727565", "74797031")
Write-Host "Size: $($Bytes.Length) bytes"
Write-Host "SFNT signature: $Signature"

if ($ValidSignatures -notcontains $Signature) {
    Write-Host "[INVALID] The file does not have a recognized TrueType/OpenType signature." -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Font file exists and has a recognized signature." -ForegroundColor Green
try {
    $Status = Invoke-RestMethod -Uri "http://localhost:8080/diagnostics/font" -TimeoutSec 3
    if (-not $Status.available) {
        Write-Host "[SERVER] The running server cannot see the font file. Restart it from the correct project folder." -ForegroundColor Red
        exit 1
    }
    if (-not $Status.validSfntSignature) {
        Write-Host "[SERVER] The server reports an invalid font signature." -ForegroundColor Red
        exit 1
    }
    Write-Host "[SERVER OK] Server sees $($Status.bytes) bytes at $($Status.url)." -ForegroundColor Green
    $Response = Invoke-WebRequest -Uri "http://localhost:8080/assets/fonts/BLOTUS.TTF" -Method Get -TimeoutSec 5 -UseBasicParsing
    Write-Host "HTTP font response: $($Response.StatusCode)"
    Write-Host "Content-Type: $($Response.Headers['Content-Type'])"
    if ($Response.StatusCode -ne 200) { exit 1 }
} catch {
    Write-Host "[INFO] Could not contact http://localhost:8080. Start Hamtaraz first, then run this script again." -ForegroundColor Yellow
}
