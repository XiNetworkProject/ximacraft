param(
  [string]$ZipPath = "$env:USERPROFILE\Downloads\Faithful 64x - March 2025 Release.zip",
  [string]$Destination = "public\resourcepack"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ZipPath)) {
  Write-Error "Zip file not found: $ZipPath"
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force

$expected = Join-Path $Destination "assets\minecraft\textures\block\stone.png"
$legacyNested = Join-Path $Destination "FaithfulPBR_256_1.1p\assets\minecraft\textures\block\stone.png"
$faithfulNested = Join-Path $Destination "Faithful 64x - March 2025 Release\assets\minecraft\textures\block\stone.png"

if (Test-Path -LiteralPath $expected) {
  Write-Host "Faithful resource pack extracted correctly."
  Write-Host "Texture path: $expected"
  exit 0
}

if (Test-Path -LiteralPath $legacyNested) {
  Write-Host "Pack appears to be nested. The runtime loader can detect this path:"
  Write-Host $legacyNested
  exit 0
}

if (Test-Path -LiteralPath $faithfulNested) {
  Write-Host "Pack appears to be nested. The runtime loader can detect this path:"
  Write-Host $faithfulNested
  exit 0
}

Write-Warning "Extraction finished, but stone.png was not found in a known path."
Write-Warning "Expected: $expected"
