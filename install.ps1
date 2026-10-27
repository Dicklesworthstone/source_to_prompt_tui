#!/usr/bin/env pwsh
param(
  [string]$Version = '',
  [string]$Owner = 'Dicklesworthstone',
  [string]$Repo = 'source_to_prompt_tui',
  [string]$Binary = 's2p',
  [string]$Dest = '',
  [switch]$FromSource,
  [switch]$Verify,
  [switch]$Quiet,
  [switch]$NoPathUpdate
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

function Test-SamePathEntry {
  param([string]$Entry, [string]$Dir)
  $a = [Environment]::ExpandEnvironmentVariables($Entry.Trim()).TrimEnd('\')
  $b = [Environment]::ExpandEnvironmentVariables($Dir.Trim()).TrimEnd('\')
  return ($a.Length -gt 0 -and $a.Equals($b, [StringComparison]::OrdinalIgnoreCase))
}

function Send-EnvironmentChange {
  # A registry write alone does not tell Explorer, so terminals opened from it would
  # keep the old PATH until the next sign-in.
  try {
    if (-not ('S2PInstaller.NativeMethods' -as [type])) {
      Add-Type -Namespace S2PInstaller -Name NativeMethods -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
'@
    }
    $result = [UIntPtr]::Zero
    # HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG, 5 s per window
    [void][S2PInstaller.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
    return $true
  } catch {
    return $false
  }
}

function Ensure-DestOnPath {
  # $EnvKey and -NoBroadcast exist for scripts/test-install-ps1.ps1, which points this at
  # a throwaway registry key instead of the real user environment.
  param([string]$Dir, [Microsoft.Win32.RegistryKey]$EnvKey = $null, [switch]$NoBroadcast)

  if ([string]::IsNullOrWhiteSpace($Dir.Trim().TrimEnd('\'))) { return }

  # Work on the raw registry value. [Environment]::GetEnvironmentVariable expands %VAR%
  # references and SetEnvironmentVariable writes REG_SZ, so a round trip through them
  # would permanently flatten every expandable entry already on the user's PATH (#9).
  $ownKey = $null -eq $EnvKey
  if ($ownKey) { $EnvKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }
  try {
    $raw = ''
    $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
    if ($EnvKey.GetValueNames() -contains 'Path') {
      $kind = $EnvKey.GetValueKind('Path')
      $raw = [string]$EnvKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    }
    if ($kind -ne [Microsoft.Win32.RegistryValueKind]::String -and $kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {
      Write-Warn "Your user PATH is stored as $kind, so it was left alone. Add $Dir to PATH yourself."
      return
    }

    foreach ($entry in $raw.Split(';')) {
      if (Test-SamePathEntry -Entry $entry -Dir $Dir) {
        Write-Ok "$Dir is already on PATH"
        return
      }
    }

    # Append to the existing text unchanged, keeping its registry type.
    $sep = if ($raw.Length -eq 0 -or $raw.EndsWith(';')) { '' } else { ';' }
    $EnvKey.SetValue('Path', $raw + $sep + $Dir, $kind)
  } finally {
    if ($ownKey) { $EnvKey.Close() }
  }

  $env:Path = "$Dir;$env:Path"
  Write-Ok "PATH updated for your user account"
  if ($NoBroadcast -or (Send-EnvironmentChange)) {
    Write-Info "Restart your terminal to pick up the PATH change"
  } else {
    Write-Warn "Could not notify running programs; sign out and back in if a new terminal cannot find $Binary"
  }
}

function Download-File {
  param([string]$Url, [string]$OutFile)
  Write-Info "Downloading $Url"
  # Windows PowerShell 5.1 redraws its progress bar for every chunk, which stretches the
  # ~100 MB binary download to minutes (#8). Assigned here, the preference is local to
  # this function.
  if ($PSVersionTable.PSVersion.Major -lt 6 -or $Quiet) { $ProgressPreference = 'SilentlyContinue' }
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -Headers @{ 'User-Agent' = 's2p-installer' } | Out-Null
}

function Maybe-VerifySha256 {
  param([string]$FilePath, [string]$ShaUrl, [switch]$Require)
  try {
    # GitHub serves the sidecar as application/octet-stream, so both PowerShells return its
    # Content as bytes, and Windows PowerShell 5.1 without -UseBasicParsing throws a
    # NullReferenceException before that. Either way no checksum was ever compared.
    $resp = Invoke-WebRequest -Uri $ShaUrl -UseBasicParsing -Headers @{ 'User-Agent' = 's2p-installer' }
    $shaText = if ($resp.Content -is [byte[]]) { [Text.Encoding]::ASCII.GetString($resp.Content) } else { [string]$resp.Content }
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

  if ($NoPathUpdate) {
    Write-Info "Left PATH unchanged (-NoPathUpdate); add $Dest to PATH to run $Binary by name"
  } else {
    Ensure-DestOnPath -Dir $Dest
  }
  Write-Ok "Done. Run: $Binary"
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $tmpFile
}
