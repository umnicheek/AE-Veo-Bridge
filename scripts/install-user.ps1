$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ManifestPath = Join-Path $RootDir "CSXS\manifest.xml"
$CepExtensionsDir = [IO.Path]::GetFullPath((Join-Path $env:APPDATA "Adobe\CEP\extensions"))
$TargetDir = [IO.Path]::GetFullPath((Join-Path $CepExtensionsDir "Veo-Bridge"))
$Tag = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = [IO.Path]::GetFullPath((Join-Path $CepExtensionsDir ("Veo-Bridge.backup-" + $Tag)))
$StageDir = [IO.Path]::GetFullPath((Join-Path $CepExtensionsDir ("Veo-Bridge.install-" + $Tag)))
$StatePath = [IO.Path]::GetFullPath((Join-Path $env:APPDATA "VeoBridge\state.json"))

if (!(Test-Path -LiteralPath $ManifestPath)) { throw "Manifest not found: $ManifestPath" }
if (!$TargetDir.StartsWith($CepExtensionsDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe extension target: $TargetDir" }
if (!$StageDir.StartsWith($CepExtensionsDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe staging target: $StageDir" }
if (!$BackupDir.StartsWith($CepExtensionsDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe backup target: $BackupDir" }

$running = Get-Process -Name "AfterFX", "CEPHtmlEngine" -ErrorAction SilentlyContinue
if ($running) {
    $names = ($running | Select-Object -ExpandProperty ProcessName -Unique) -join ", "
    throw "Close After Effects and all CEP windows before installing Veo Bridge ($names still running). Unsaved AE work is not closed automatically."
}

New-Item -ItemType Directory -Force -Path $CepExtensionsDir | Out-Null
if (Test-Path -LiteralPath $StageDir) { Remove-Item -LiteralPath $StageDir -Recurse -Force }
New-Item -ItemType Directory -Path $StageDir | Out-Null

foreach ($relative in @("CSXS", "css", "js", "jsx", "index.html", "gallery.html")) {
    $source = Join-Path $RootDir $relative
    if (!(Test-Path -LiteralPath $source)) { throw "Required extension item is missing: $relative" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $StageDir $relative) -Recurse -Force
}

[xml]$stagedManifest = Get-Content -LiteralPath (Join-Path $StageDir "CSXS\manifest.xml") -Raw
$version = $stagedManifest.ExtensionManifest.ExtensionBundleVersion
if ($version -ne "0.4.1") { throw "Refusing to install unexpected extension version: $version" }

if (Test-Path -LiteralPath $StatePath) {
    Copy-Item -LiteralPath $StatePath -Destination ($StatePath + ".backup-" + $Tag) -Force
}
if (Test-Path -LiteralPath $TargetDir) {
    Move-Item -LiteralPath $TargetDir -Destination $BackupDir
}

try {
    Move-Item -LiteralPath $StageDir -Destination $TargetDir
} catch {
    if (!(Test-Path -LiteralPath $TargetDir) -and (Test-Path -LiteralPath $BackupDir)) {
        Move-Item -LiteralPath $BackupDir -Destination $TargetDir
    }
    throw
}

Write-Host "Installed Veo Bridge $version to $TargetDir"
if (Test-Path -LiteralPath $BackupDir) { Write-Host "Previous extension backup: $BackupDir" }
if (Test-Path -LiteralPath ($StatePath + ".backup-" + $Tag)) { Write-Host "State backup: $StatePath.backup-$Tag" }
