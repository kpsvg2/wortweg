# Installer payload: unpacks Wortweg, keeps data/ and runtime/ on update, fetches portable Node.js if needed,
# and creates a desktop shortcut.
param(
  [string]$Dest = (Join-Path $env:LOCALAPPDATA 'Programs\Wortweg'),
  [switch]$ForceNode,
  [switch]$NoShortcut,
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

function Get-SystemNodeOk {
  if ($ForceNode) { return $false }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    $candidate = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path $candidate) { $node = $candidate } else { return $false }
  } else { $node = $node.Source }
  try {
    $version = (& $node --version).Trim().TrimStart('v')
    return ([int]$version.Split('.')[0] -ge 18)
  } catch { return $false }
}

function Install-PortableNode($target) {
  Step 'Checking the Node.js version'
  $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $release = $index | Where-Object { $_.lts } | Select-Object -First 1
  $version = $release.version
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $name = "node-$version-win-$arch"
  $tmp = Join-Path $env:TEMP "wortweg-node-$([guid]::NewGuid())"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    Step "Downloading Node.js $version"
    $zip = Join-Path $tmp "$name.zip"
    Invoke-WebRequest "https://nodejs.org/dist/$version/$name.zip" -OutFile $zip -UseBasicParsing
    $sums = (Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing).Content
    $expected = ($sums -split "`n" | Where-Object { $_ -match "\s$name\.zip$" }) -replace '\s.*$', ''
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash
    if (-not $expected -or $actual -ne $expected.Trim().ToUpper()) { throw 'Could not verify the Node.js download (SHA256 mismatch).' }
    Step 'Unpacking Node.js'
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Move-Item (Join-Path $tmp $name) $target
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

function Stop-OldServer($root) {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
  $payload = Join-Path $PSScriptRoot 'wortweg.zip'
  if (-not (Test-Path $payload)) { throw "wortweg.zip not found: $payload" }

  Write-Host ''
  Write-Host '  Wortweg setup' -ForegroundColor Green
  Write-Host "  Location: $Dest"
  Write-Host ''

  Stop-OldServer $Dest

  $keepData = $null
  $keepRuntime = $null
  if (Test-Path $Dest) {
    Step 'Updating the existing install (progress is kept)'
    $stash = Join-Path $env:TEMP "wortweg-keep-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Force $stash | Out-Null
    if (Test-Path (Join-Path $Dest 'data')) { Move-Item (Join-Path $Dest 'data') $stash; $keepData = Join-Path $stash 'data' }
    if (Test-Path (Join-Path $Dest 'runtime')) { Move-Item (Join-Path $Dest 'runtime') $stash; $keepRuntime = Join-Path $stash 'runtime' }
    Remove-Item -Recurse -Force $Dest
  }

  Step 'Copying app files'
  New-Item -ItemType Directory -Force $Dest | Out-Null
  [IO.Compression.ZipFile]::ExtractToDirectory($payload, $Dest)

  if ($keepData) {
    $newData = Join-Path $Dest 'data'
    if (Test-Path $newData) { Remove-Item -Recurse -Force $newData }
    Move-Item $keepData $newData
  }
  if ($keepRuntime) { Move-Item $keepRuntime (Join-Path $Dest 'runtime') }
  if ($stash) { Remove-Item -Recurse -Force $stash -ErrorAction SilentlyContinue }

  $runtime = Join-Path $Dest 'runtime'
  if (Get-SystemNodeOk) {
    Step 'A suitable Node.js is already installed, skipping download'
  } elseif ((Test-Path (Join-Path $runtime 'node.exe')) -and -not $ForceNode) {
    Step 'Node.js already installed'
  } else {
    Install-PortableNode $runtime
  }

  $launcher = Join-Path $Dest 'Wortweg.cmd'
  if (-not $NoShortcut) {
    Step 'Creating the desktop shortcut'
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut((Join-Path $desktop 'Wortweg.lnk'))
    $link.TargetPath = $launcher
    $link.WorkingDirectory = $Dest
    $link.IconLocation = (Join-Path $Dest 'windows\wortweg.ico') + ',0'
    $link.WindowStyle = 7
    $link.Description = 'Wortweg'
    $link.Save()
  }

  Write-Host ''
  Write-Host '  Setup complete.' -ForegroundColor Green
  Write-Host '  Open it with the Wortweg icon on your desktop.'
  Write-Host ''

  if (-not $NoLaunch) {
    Step 'Starting Wortweg'
    Start-Process -FilePath $launcher -WorkingDirectory $Dest -WindowStyle Minimized
    Start-Sleep -Seconds 3
  }
  exit 0
} catch {
  Write-Host ''
  Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  Check your internet connection and run the setup again.'
  Write-Host ''
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}
