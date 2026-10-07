# Builds a one-file Windows installer (windows\dist\Wortweg-Setup.exe) with IExpress.
# Your .env (API keys) and data/goethe are only bundled with -IncludeKeys; never publish such a build.
param([switch]$IncludeKeys)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$here = $PSScriptRoot
$project = Split-Path $here -Parent
$dist = Join-Path $here 'dist'
$work = Join-Path $env:TEMP "wortweg-build-$([guid]::NewGuid())"
$stage = Join-Path $work 'stage'
$pack = Join-Path $work 'pack'
New-Item -ItemType Directory -Force $stage, $pack, $dist | Out-Null

try {
  robocopy $project $stage /E /NFL /NDL /NJH /NJS /NP `
    /XD (Join-Path $project 'windows\dist') (Join-Path $project 'runtime') (Join-Path $project '.git') (Join-Path $project '.github') (Join-Path $project 'node_modules') (Join-Path $project 'data') (Join-Path $project 'docs\screenshots') (Join-Path $project 'tools') `
    /XF .env server.log | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }
  # Private builds also carry your optional Goethe lists; public builds never do.
  if ($IncludeKeys -and (Test-Path (Join-Path $project '.env'))) { Copy-Item (Join-Path $project '.env') $stage }
  if ($IncludeKeys -and (Test-Path (Join-Path $project 'data\goethe'))) { robocopy (Join-Path $project 'data\goethe') (Join-Path $stage 'data\goethe') /E /NFL /NDL /NJH /NJS /NP | Out-Null }

  [IO.Compression.ZipFile]::CreateFromDirectory($stage, (Join-Path $pack 'wortweg.zip'))
  Copy-Item (Join-Path $here 'install.ps1'), (Join-Path $here 'install.cmd') $pack

  $target = Join-Path $dist 'Wortweg-Setup.exe'
  if (Test-Path $target) { Remove-Item -Force $target }
  $sed = Join-Path $work 'wortweg.sed'
  @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$target
FriendlyName=Wortweg Setup
AppLaunched=cmd /c install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0="install.cmd"
FILE1="install.ps1"
FILE2="wortweg.zip"
[SourceFiles]
SourceFiles0=$pack\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
"@ | Set-Content -Path $sed -Encoding ASCII

  $proc = Start-Process -FilePath "$env:SystemRoot\System32\iexpress.exe" -ArgumentList '/N', '/Q', $sed -Wait -PassThru
  if (-not (Test-Path $target)) { throw "iexpress failed (code $($proc.ExitCode))" }
  Write-Host "Ready: $target ($([math]::Round((Get-Item $target).Length / 1KB)) KB)"
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
