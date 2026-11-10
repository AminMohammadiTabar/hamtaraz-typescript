param(
  [Parameter(Mandatory=$true)][string]$Bank,
  [Parameter(Mandatory=$true)][string]$Tbs
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Bank)) { throw "Bank file not found: $Bank" }
if (-not (Test-Path -LiteralPath $Tbs)) { throw "TBS file not found: $Tbs" }
$env:GOLDEN_BANK = (Resolve-Path -LiteralPath $Bank).Path
$env:GOLDEN_TBS = (Resolve-Path -LiteralPath $Tbs).Path
npm test
if ($LASTEXITCODE -ne 0) { throw 'Node tests failed' }
