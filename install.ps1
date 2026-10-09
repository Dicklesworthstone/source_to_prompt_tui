#!/usr/bin/env pwsh
param(
  [string]$Version = '',
  [string]$Owner = 'Dicklesworthstone',
  [string]$Repo = 'source_to_prompt_tui',
  [string]$Binary = 's2p',
  [string]$Dest = '',
  [switch]$FromSource,
  [switch]$Verify,
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  # GitHub requires TLS 1.2+. Older Windows PowerShell defaults may exclude it.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
  # Ignore if unavailable (PowerShell 7+ on some platforms).
}

function Write-Log {
  param([string]$Message)
  if (-not $Quiet) { Write-Host $Message }
}

function Write-Info { param([string]$Message) Write-Log ("[info] {0}" -f $Message) }
function Write-Ok { param([string]$Message) Write-Log ("[ok] {0}" -f $Message) }
function Write-Warn { param([string]$Message) Write-Log ("[warn] {0}" -f $Message) }

function Get-InstallName {
  param([string]$Name)
  if ($Name.ToLowerInvariant().EndsWith('.exe')) { return $Name }
  return ($Name + '.exe')
}

function Get-DefaultDest {
  $localAppData = $env:LOCALAPPDATA
  if ([string]::IsNullOrWhiteSpace($localAppData)) {
    return (Join-Path -Path $env:USERPROFILE -ChildPath '.local\bin')
  }
  return (Join-Path -Path $localAppData -ChildPath 'Programs\s2p\bin')
}

function Resolve-LatestVersion {
  param([string]$OwnerParam, [string]$RepoParam)
  $latestUrl = "https://api.github.com/repos/$OwnerParam/$RepoParam/releases/latest"
  Write-Info "Resolving latest version..."
  try {
    $resp = Invoke-RestMethod -Uri $latestUrl -Headers @{ 'Accept' = 'application/vnd.github+json' }
    if ($null -ne $resp -and -not [string]::IsNullOrWhiteSpace($resp.tag_name)) {
      return [string]$resp.tag_name
    }
  } catch {
    return ''
  }
  return ''
}

function Ensure-DestOnPath {
  param([string]$Dir)

  $dirNorm = $Dir.TrimEnd('\')
  if ([string]::IsNullOrWhiteSpace($dirNorm)) { return }

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $existing = @()
  if (-not [string]::IsNullOrWhiteSpace($userPath)) {
    $existing = $userPath.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
  }

  $already = $false
  foreach ($p in $existing) {
    if ($p.TrimEnd('\').Equals($dirNorm, [StringComparison]::OrdinalIgnoreCase)) {
      $already = $true
      break
    }
  }

  if ($already) {
    Write-Ok "$Dir is already on PATH"
    return
  }

  $newUserPath = if ($existing.Count -gt 0) { ($existing + $Dir) -join ';' } else { $Dir }
  [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
  $env:Path = "$Dir;$env:Path"
  Write-Ok "PATH updated for your user account"
  Write-Info "Restart your terminal to pick up the PATH change"
}

function Download-File {
  param([string]$Url, [string]$OutFile)
  Write-Info "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -Headers @{ 'User-Agent' = 's2p-installer' } | Out-Null
}

function Maybe-VerifySha256 {
  param([string]$FilePath, [string]$ShaUrl, [switch]$Require)
  try {
    $shaText = (Invoke-WebRequest -Uri $ShaUrl -Headers @{ 'User-Agent' = 's2p-installer' }).Content
    $expected = ($shaText -split '\s+')[0].Trim()
    if ($expected -notmatch '^[0-9a-fA-F]{64}$') {
      throw "Checksum file did not contain a SHA256 hash"
    }
    $actual = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected.ToLowerInvariant()) {
      throw "Checksum mismatch"
    }
    Write-Ok "Checksum verified"
  } catch {
    if ($Require) { throw }
    Write-Warn "Checksum could not be verified; continuing without verification"
  }
}

function Build-From-Source {
  param([string]$OwnerParam, [string]$RepoParam, [string]$OutFile)

  Write-Info "Building from source (requires git + bun)"
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is required but was not found on PATH" }
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw "bun is required but was not found on PATH" }

  $tmpRoot = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("s2p-install-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmpRoot | Out-Null
  $srcDir = Join-Path -Path $tmpRoot -ChildPath 'src'

  try {
    git clone --depth 1 "https://github.com/$OwnerParam/$RepoParam.git" $srcDir | Out-Null
    Push-Location $srcDir
    try {
      bun install --frozen-lockfile | Out-Null
      bun run build:win-x64 | Out-Null
    } finally {
      Pop-Location
    }

    $built = Join-Path -Path $srcDir -ChildPath 'dist\s2p-windows-x64.exe'
    if (-not (Test-Path -Path $built -PathType Leaf)) { throw "Build failed; expected output not found: $built" }
    Copy-Item -Force -Path $built -Destination $OutFile
  } finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmpRoot
  }
}

$installName = Get-InstallName -Name $Binary
if ([string]::IsNullOrWhiteSpace($Dest)) { $Dest = Get-DefaultDest }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$destPath = Join-Path -Path $Dest -ChildPath $installName

$arch = $env:PROCESSOR_ARCHITECTURE
$archWow = $env:PROCESSOR_ARCHITEW6432
$effectiveArch = if (-not [string]::IsNullOrWhiteSpace($archWow)) { $archWow } else { $arch }
$isX64 = $effectiveArch -eq 'AMD64'
if (-not $isX64 -and -not $FromSource) {
  Write-Warn "No pre-built Windows binary for this architecture; falling back to from-source build."
  $FromSource = $true
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  $resolved = Resolve-LatestVersion -OwnerParam $Owner -RepoParam $Repo
  if (-not [string]::IsNullOrWhiteSpace($resolved)) { $Version = $resolved }
}

$tagPath = if ([string]::IsNullOrWhiteSpace($Version)) { 'latest/download' } else { "download/$Version" }
$asset = 's2p-windows-x64.exe'
$baseUrl = "https://github.com/$Owner/$Repo/releases/$tagPath/$asset"
$shaUrl = "$baseUrl.sha256"

$tmpFile = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("s2p-" + [Guid]::NewGuid().ToString('N') + '.exe')

try {
  if ($FromSource) {
    Build-From-Source -OwnerParam $Owner -RepoParam $Repo -OutFile $tmpFile
  } else {
    try {
      Download-File -Url $baseUrl -OutFile $tmpFile
    } catch {
      Write-Warn "Download failed; falling back to from-source build."
      Build-From-Source -OwnerParam $Owner -RepoParam $Repo -OutFile $tmpFile
    }
    Maybe-VerifySha256 -FilePath $tmpFile -ShaUrl $shaUrl -Require:$Verify
  }

  Copy-Item -Force -Path $tmpFile -Destination $destPath
  try { Unblock-File -Path $destPath -ErrorAction SilentlyContinue } catch {}
  Write-Ok "Installed $installName to $Dest"

  Ensure-DestOnPath -Dir $Dest
  Write-Ok "Done. Run: $Binary"
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $tmpFile
}
