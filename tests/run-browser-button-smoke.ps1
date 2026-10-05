$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$edgeCandidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$edge) { throw "Microsoft Edge was not found." }

$profile = Join-Path $env:TEMP ("veobridge-edge-" + [guid]::NewGuid().ToString("N"))
$port = Get-Random -Minimum 9300 -Maximum 9900
$rootUri = ([Uri]($root + "\")).AbsoluteUri.TrimEnd("/")
$process = $null

New-Item -ItemType Directory -Path $profile | Out-Null
try {
    $process = Start-Process -FilePath $edge -ArgumentList @(
        "--headless=new",
        "--remote-debugging-port=$port",
        "--user-data-dir=$profile",
        "--no-first-run",
        "--disable-gpu",
        "about:blank"
    ) -WindowStyle Hidden -PassThru
    & node.exe (Join-Path $PSScriptRoot "browser-button-smoke.js") $port $rootUri
    if ($LASTEXITCODE -ne 0) { throw "Browser button smoke failed with exit code $LASTEXITCODE." }
} finally {
    if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id -Force }
    $resolvedProfile = [IO.Path]::GetFullPath($profile)
    $resolvedTemp = [IO.Path]::GetFullPath($env:TEMP) + [IO.Path]::DirectorySeparatorChar
    if ($resolvedProfile.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
    }
}
