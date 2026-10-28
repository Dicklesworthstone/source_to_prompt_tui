# Installer integrity (#7) and Windows user PATH (#9) regression checks. Run under both shells:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-install-ps1.ps1
#   pwsh -NoProfile -File scripts\test-install-ps1.ps1
# Integrity tests use real loopback HTTP transfers, hashing, filesystem operations, and
# (when git and Bun are available) pinned local Git fixtures. They never contact GitHub.
# The installer's functions are loaded from its syntax tree to isolate the real user PATH.
# Registry tests use volatile keys under HKCU\Software, discarded by Windows at sign-out.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installer = (Resolve-Path (Join-Path $PSScriptRoot '..\install.ps1')).Path
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw "install.ps1 does not parse: $($parseErrors -join '; ')" }
$params = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
if ($params -notcontains 'NoPathUpdate') { throw 'install.ps1 has no -NoPathUpdate parameter' }

# Globals the installer's helpers read.
$Quiet = $true
$Binary = 's2p'
$functions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)
foreach ($f in $functions) { . ([scriptblock]::Create($f.Extent.Text)) }
if (-not (Get-Command Ensure-DestOnPath).Parameters.ContainsKey('EnvKey')) {
  throw 'Ensure-DestOnPath cannot be pointed at a test key; refusing to run it against the real user PATH'
}

function Get-RawPath {
  param([Microsoft.Win32.RegistryKey]$Key)
  if ($Key.GetValueNames() -notcontains 'Path') { return '<missing>' }
  $raw = $Key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  return ('{0}|{1}' -f $Key.GetValueKind('Path'), $raw)
}

$script:failures = 0
$script:checks = 0
function Assert-Equal {
  param([string]$Name, [string]$Actual, [string]$Expected)
  $script:checks++
  if ($Actual -ceq $Expected) {
    Write-Host "ok   $Name"
  } else {
    $script:failures++
    Write-Host "FAIL $Name`n     expected: $Expected`n     actual:   $Actual"
  }
}

function Assert-Throws {
  param([string]$Name, [scriptblock]$Action, [string]$Pattern)
  $caught = ''
  $messages = @()
  try { & $Action 6>&1 | ForEach-Object { $messages += [string]$_ } } catch { $caught = $_.Exception.Message }
  Assert-Equal $Name ([string]($caught -match $Pattern)) 'True'
  Assert-Equal "$Name emits no install success" ([string](($messages -join "`n") -notmatch '\[ok\] Installed|Done\. Run:')) 'True'
  if ($caught -notmatch $Pattern) { Write-Host "     caught: $caught" }
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('s2p-integrity-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$payload = Join-Path $testRoot 'payload'
[System.IO.File]::WriteAllText($payload, "release fixture, version one`n", [Text.Encoding]::ASCII)
$digest = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()
$asset = 's2p-windows-x64.exe'
[System.IO.File]::WriteAllText((Join-Path $testRoot 'octet.sha256'), "$digest  $asset`n", [Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $testRoot 'text.sha256'), "$($digest.ToUpperInvariant()) *$asset`r`n", [Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $testRoot 'bare.sha256'), "  $digest`r`n", [Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $testRoot 'mismatch.sha256'), (('0' * 64) + "  $asset`n"), [Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $testRoot 'empty.sha256'), '', [Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $testRoot 'whitespace.sha256'), " `r`n`t", [Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $testRoot 'invalid.sha256'), 'not-a-checksum', [Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $testRoot 'multiple.sha256'), "$digest  $asset`n$digest  $asset`n", [Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText((Join-Path $testRoot 'wrong-name.sha256'), "$digest  another.exe`n", [Text.Encoding]::ASCII)
[System.IO.File]::WriteAllBytes((Join-Path $testRoot 'empty-payload'), [byte[]]@())
$emptyDigest = (Get-FileHash -LiteralPath (Join-Path $testRoot 'empty-payload') -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $testRoot 'empty-payload.sha256'), "$emptyDigest  $asset`n", [Text.Encoding]::ASCII)
$upgradePayload = Join-Path $testRoot 'upgrade-payload'
[System.IO.File]::WriteAllText($upgradePayload, "release fixture, version two with different bytes`n", [Text.Encoding]::ASCII)
$upgradeDigest = (Get-FileHash -LiteralPath $upgradePayload -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $testRoot 'upgrade.sha256'), "$upgradeDigest  $asset`n", [Text.Encoding]::ASCII)

# A socket server deliberately closes one response before its advertised content length.
# This exercises the real Invoke-WebRequest failure, including any partially written file.
$server = Start-Job -ArgumentList $testRoot -ScriptBlock {
  param($Root)
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  [IO.File]::WriteAllText((Join-Path $Root 'port'), [string]$listener.LocalEndpoint.Port)
  try {
    while ($true) {
      # Yield while idle so Stop-Job can cancel the server instead of blocking forever
      # inside AcceptTcpClient. Client reads are bounded for the same reason.
      if (-not $listener.Pending()) { Start-Sleep -Milliseconds 20; continue }
      $client = $listener.AcceptTcpClient()
      $client.ReceiveTimeout = 5000
      try {
        $stream = $client.GetStream()
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
        $request = $reader.ReadLine()
        while (-not [string]::IsNullOrEmpty($reader.ReadLine())) {}
        $route = ($request -split ' ')[1].TrimStart('/')
        $code = 200
        $contentType = if ($route -eq 'text.sha256') { 'text/plain' } else { 'application/octet-stream' }
        $partial = $route -like 'interrupt*'
        $file = Join-Path $Root $route
        if ($partial) { $file = Join-Path $Root 'payload' }
        if ($route -eq 'gone') { $code = 410 }
        elseif ($route -eq 'server-error') { $code = 500 }
        elseif (-not (Test-Path -LiteralPath $file -PathType Leaf)) { $code = 404 }
        if ($code -eq 200) { $body = [IO.File]::ReadAllBytes($file) }
        else { $body = [Text.Encoding]::ASCII.GetBytes('unavailable') }
        $length = $body.Length
        if ($partial) { $length += 4096 }
        $header = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $code Fixture`r`nContent-Length: $length`r`nContent-Type: $contentType`r`nConnection: close`r`n`r`n")
        $stream.Write($header, 0, $header.Length)
        $stream.Write($body, 0, $body.Length)
        $stream.Flush()
      } finally { $client.Close() }
    }
  } finally { $listener.Stop() }
}

try {
  $portFile = Join-Path $testRoot 'port'
  for ($attempt = 0; $attempt -lt 200 -and -not (Test-Path -LiteralPath $portFile); $attempt++) {
    if ($server.State -eq 'Failed') { throw "HTTP fixture failed: $(Receive-Job $server)" }
    Start-Sleep -Milliseconds 50
  }
  if (-not (Test-Path -LiteralPath $portFile)) { throw 'HTTP fixture did not start' }
  $base = 'http://127.0.0.1:' + [IO.File]::ReadAllText($portFile)
  $Quiet = $false
  foreach ($sidecar in @('octet.sha256', 'text.sha256', 'bare.sha256')) {
    $messages = @(Maybe-VerifySha256 -FilePath $payload -ShaUrl "$base/$sidecar" -Require 6>&1)
    Assert-Equal "$sidecar accepted by real checksum comparison" ([string](($messages -join "`n") -match 'Checksum verified')) 'True'
  }
  foreach ($required in @($false, $true)) {
    foreach ($sidecar in @('mismatch.sha256', 'empty.sha256', 'whitespace.sha256', 'invalid.sha256', 'multiple.sha256', 'wrong-name.sha256')) {
      Assert-Throws "$sidecar rejected (required=$required)" {
        Maybe-VerifySha256 -FilePath $payload -ShaUrl "$base/$sidecar" -Require:$required
      } 'Checksum'
    }
    foreach ($route in @('interrupt-sha256', 'server-error')) {
      Assert-Throws "$route never downgraded (required=$required)" {
        Maybe-VerifySha256 -FilePath $payload -ShaUrl "$base/$route" -Require:$required
      } '.+'
    }
  }
  foreach ($route in @('missing', 'gone')) {
    $messages = @(Maybe-VerifySha256 -FilePath $payload -ShaUrl "$base/$route" 6>&1)
    Assert-Equal "optional $route sidecar warns" ([string](($messages -join "`n") -match 'Checksum not available')) 'True'
    Assert-Throws "required $route sidecar rejected" {
      Maybe-VerifySha256 -FilePath $payload -ShaUrl "$base/$route" -Require
    } '.+'
  }

  # Exercise the real HTTP/metadata path in a runspace without Get-FileHash.
  # This avoids replacing the hash command and leaves this shell's modules intact.
  $state = [System.Management.Automation.Runspaces.InitialSessionState]::Create()
  $state.LanguageMode = [System.Management.Automation.PSLanguageMode]::FullLanguage
  foreach ($name in @('Get-Command', 'Invoke-WebRequest', 'Write-Host')) {
    $command = Get-Command $name
    $state.Commands.Add([System.Management.Automation.Runspaces.SessionStateCmdletEntry]::new($name, $command.ImplementingType, $null))
  }
  $state.Variables.Add([System.Management.Automation.Runspaces.SessionStateVariableEntry]::new('PSModuleAutoLoadingPreference', 'None', 'Disable implicit hash-module import'))
  $state.Variables.Add([System.Management.Automation.Runspaces.SessionStateVariableEntry]::new('Quiet', $true, 'Suppress helper logs'))
  $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($state)
  $runspace.Open()
  $engine = [PowerShell]::Create()
  $engine.Runspace = $runspace
  try {
    $definitions = @($functions | Where-Object { $_.Name -in @('Write-Log', 'Write-Ok', 'Write-Warn', 'Test-HttpNotFound', 'Maybe-VerifySha256', 'Assert-Sha256Checksum') } | ForEach-Object { $_.Extent.Text }) -join "`n"
    [void]$engine.AddScript($definitions).Invoke()
    if ($engine.HadErrors) { throw "Could not isolate hashing utility: $($engine.Streams.Error -join '; ')" }
    foreach ($required in @($false, $true)) {
      $engine.Commands.Clear()
      $engine.Streams.Error.Clear()
      $caught = ''
      try { [void]$engine.AddCommand('Maybe-VerifySha256').AddParameter('FilePath', $payload).AddParameter('ShaUrl', "$base/octet.sha256").AddParameter('Require', $required).Invoke() }
      catch { $caught = $_.Exception.Message }
      $caught += $engine.Streams.Error -join "`n"
      Assert-Equal "missing Get-FileHash rejects supplied metadata (required=$required)" ([string]($caught -match 'Get-FileHash.*unavailable')) 'True'
    }
  } finally {
    $engine.Dispose()
    $runspace.Dispose()
  }
  Assert-Throws 'hash read failure is fatal without Verify' {
    Maybe-VerifySha256 -FilePath (Join-Path $testRoot 'does-not-exist') -ShaUrl "$base/octet.sha256"
  } '.+'

  $installed = Join-Path $testRoot 'installed.exe'
  Install-Artifact -BaseUrl "$base/payload" -ShaUrl "$base/octet.sha256" -DestPath $installed -OwnerParam fixture -RepoParam fixture -VersionParam v1 -Require
  Assert-Equal 'verified transaction installs identical bytes' ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToLowerInvariant()) $digest
  $optionalDest = Join-Path $testRoot 'optional.exe'
  $messages = @(Install-Artifact -BaseUrl "$base/payload" -ShaUrl "$base/missing" -DestPath $optionalDest -OwnerParam fixture -RepoParam fixture -VersionParam v1 6>&1)
  Assert-Equal 'missing optional sidecar permits installation' ((Get-FileHash -LiteralPath $optionalDest -Algorithm SHA256).Hash.ToLowerInvariant()) $digest
  Assert-Equal 'unverified install is labeled accurately' ([string](($messages -join "`n") -match 'Checksum not available' -and ($messages -join "`n") -notmatch 'Checksum verified')) 'True'
  Assert-Throws 'empty artifact is rejected even with matching checksum' {
    Install-Artifact -BaseUrl "$base/empty-payload" -ShaUrl "$base/empty-payload.sha256" -DestPath $installed -OwnerParam fixture -RepoParam fixture -VersionParam v1 -Require
  } 'empty artifact'
  Assert-Equal 'empty artifact preserves existing executable' ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToLowerInvariant()) $digest
  Push-Location $testRoot
  try {
    Install-Artifact -BaseUrl "$base/payload" -ShaUrl "$base/octet.sha256" -DestPath 'relative.exe' -OwnerParam fixture -RepoParam fixture -VersionParam v1 -Require
  } finally { Pop-Location }
  Assert-Equal 'relative destination follows PowerShell location' ((Get-FileHash -LiteralPath (Join-Path $testRoot 'relative.exe') -Algorithm SHA256).Hash.ToLowerInvariant()) $digest
  foreach ($sidecar in @('mismatch.sha256', 'empty.sha256')) {
    Assert-Throws "$sidecar prevents destination replacement" {
      Install-Artifact -BaseUrl "$base/payload" -ShaUrl "$base/$sidecar" -DestPath $installed -OwnerParam fixture -RepoParam fixture -VersionParam v1
    } 'Checksum'
    Assert-Equal "$sidecar preserves existing executable" ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToLowerInvariant()) $digest
  }
  Assert-Throws 'interrupted binary download never falls back' {
    Install-Artifact -BaseUrl "$base/interrupt-binary" -ShaUrl "$base/octet.sha256" -DestPath $installed -OwnerParam fixture -RepoParam fixture -VersionParam v1
  } '.+'
  Assert-Equal 'interrupted binary preserves existing executable' ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToLowerInvariant()) $digest
  Assert-Throws 'required verification forbids missing-asset source fallback' {
    Install-Artifact -BaseUrl "$base/missing" -ShaUrl "$base/octet.sha256" -DestPath $installed -OwnerParam fixture -RepoParam fixture -VersionParam v1 -Require
  } 'forbids unverified source fallback'
  Assert-Throws 'required verification forbids explicit source build' {
    Install-Artifact -BaseUrl "$base/payload" -ShaUrl "$base/octet.sha256" -DestPath $installed -OwnerParam fixture -RepoParam fixture -VersionParam v1 -Require -SourceRequested
  } 'cannot be combined with a source build'
  $blocked = Join-Path $testRoot 'blocked.exe'
  New-Item -ItemType Directory -Path $blocked | Out-Null
  Assert-Throws 'destination write failure stops installation' {
    Install-Artifact -BaseUrl "$base/payload" -ShaUrl "$base/octet.sha256" -DestPath $blocked -OwnerParam fixture -RepoParam fixture -VersionParam v1 -Require
  } '.+'
  Assert-Equal 'failed write does not install inside a directory' ([string](@(Get-ChildItem -LiteralPath $blocked).Count)) '0'

  $upgradeDest = Join-Path $testRoot 'upgrade.exe'
  [IO.File]::Copy($payload, $upgradeDest)
  Install-Artifact -BaseUrl "$base/upgrade-payload" -ShaUrl "$base/upgrade.sha256" -DestPath $upgradeDest -OwnerParam fixture -RepoParam fixture -VersionParam v2 -Require
  Assert-Equal 'successful upgrade publishes the complete new artifact' ((Get-FileHash -LiteralPath $upgradeDest -Algorithm SHA256).Hash.ToLowerInvariant()) $upgradeDigest
  Assert-Equal 'successful publication removes private stage and backup' ([string](@(Get-ChildItem -LiteralPath $testRoot -Filter '.s2p-install-*' -Force).Count)) '0'

  # Use actual filesystem states documented for ReplaceFileW failures. This exercises
  # recovery without claiming to reproduce Windows error 1177 on a non-Windows host.
  $recoveryBackup = Join-Path $testRoot 'recovery-backup.exe'
  $recoveryDest = Join-Path $testRoot 'recovery-destination.exe'
  [IO.File]::Copy($payload, $recoveryBackup)
  $recoveryMessage = Restore-ArtifactBackup -BackupPath $recoveryBackup -DestPath $recoveryDest
  Assert-Equal 'replacement failure recovery restores an absent destination' ((Get-FileHash -LiteralPath $recoveryDest -Algorithm SHA256).Hash.ToLowerInvariant()) $digest
  Assert-Equal 'restored backup is moved, not left as a second recovery copy' ([string]([IO.File]::Exists($recoveryBackup))) 'False'
  [IO.File]::Copy($upgradePayload, $recoveryBackup)
  $recoveryMessage = Restore-ArtifactBackup -BackupPath $recoveryBackup -DestPath $recoveryDest
  Assert-Equal 'recovery never overwrites a destination that appeared concurrently' ((Get-FileHash -LiteralPath $recoveryDest -Algorithm SHA256).Hash.ToLowerInvariant()) $digest
  Assert-Equal 'recovery preserves backup when the destination is occupied' ((Get-FileHash -LiteralPath $recoveryBackup -Algorithm SHA256).Hash.ToLowerInvariant()) $upgradeDigest
  Assert-Equal 'recovery reports the retained backup path' ([string]($recoveryMessage.Contains($recoveryBackup))) 'True'
  $unrestorable = Join-Path (Join-Path $testRoot 'missing-recovery-directory') 's2p.exe'
  $recoveryMessage = Restore-ArtifactBackup -BackupPath $recoveryBackup -DestPath $unrestorable
  Assert-Equal 'failed restore retains complete backup bytes' ((Get-FileHash -LiteralPath $recoveryBackup -Algorithm SHA256).Hash.ToLowerInvariant()) $upgradeDigest
  Assert-Equal 'failed restore identifies the retained backup' ([string]($recoveryMessage.Contains($recoveryBackup) -and $recoveryMessage -match 'restore failed')) 'True'
  $recoveryMessage = Restore-ArtifactBackup -BackupPath $recoveryBackup -DestPath $blocked
  Assert-Equal 'recovery treats a directory collision as an occupied destination' ([string](@(Get-ChildItem -LiteralPath $blocked).Count)) '0'
  Assert-Equal 'directory collision preserves recovery backup' ((Get-FileHash -LiteralPath $recoveryBackup -Algorithm SHA256).Hash.ToLowerInvariant()) $upgradeDigest

  # Linux provides a real per-process file-size limit. Apply it after CoreCLR starts
  # (applying it before startup prevents its memory mappings), then restore it in finally.
  # The installer still uses native file I/O; neither copy nor hash results are mocked.
  if ($env:OS -ne 'Windows_NT' -and (Get-Command uname -ErrorAction SilentlyContinue) -and ((& uname -s) -eq 'Linux')) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace S2PInstallerTests {
  public sealed class FileSizeLimit : IDisposable {
    [StructLayout(LayoutKind.Sequential)]
    struct Limit { public UIntPtr Current; public UIntPtr Maximum; }
    [DllImport("libc", SetLastError = true)] static extern int getrlimit(int resource, out Limit limit);
    [DllImport("libc", SetLastError = true)] static extern int setrlimit(int resource, ref Limit limit);
    [DllImport("libc", SetLastError = true)] static extern IntPtr signal(int signum, IntPtr handler);
    Limit previous;
    IntPtr previousSignal;
    bool applied;
    public FileSizeLimit(UIntPtr bytes) {
      if (getrlimit(1, out previous) != 0) throw new Exception("getrlimit failed");
      previousSignal = signal(25, new IntPtr(1)); // SIGXFSZ, SIG_IGN: report EFBIG instead of killing this shell.
      if (previousSignal == new IntPtr(-1)) throw new Exception("signal failed");
      Limit limited = previous;
      limited.Current = bytes;
      if (setrlimit(1, ref limited) != 0) {
        signal(25, previousSignal);
        throw new Exception("setrlimit failed");
      }
      applied = true;
    }
    public void Dispose() {
      if (!applied) return;
      int result = setrlimit(1, ref previous);
      signal(25, previousSignal);
      applied = false;
      if (result != 0) throw new Exception("Could not restore file-size limit");
    }
  }
}
'@
    $limitedDest = Join-Path $testRoot 'limited-upgrade.exe'
    $limitedSource = Join-Path $testRoot 'limited-replacement.exe'
    $truePath = @(Get-Command true -CommandType Application)[0].Source
    $falsePath = @(Get-Command false -CommandType Application)[0].Source
    [IO.File]::Copy($truePath, $limitedDest)
    [IO.File]::Copy($falsePath, $limitedSource)
    if ((Get-Item -LiteralPath $limitedSource).Length -le 8192) { throw 'Native replacement fixture does not exceed the file-size limit' }
    $beforeLimitedHash = (Get-FileHash -LiteralPath $limitedDest -Algorithm SHA256).Hash
    & $limitedDest
    Assert-Equal 'existing executable runs before limited upgrade' ([string]$LASTEXITCODE) '0'
    $limit = [S2PInstallerTests.FileSizeLimit]::new([UIntPtr]8192)
    try {
      Assert-Throws 'native staging write failure stops publication' {
        Publish-Artifact -FilePath $limitedSource -DestPath $limitedDest
      } 'Could not stage installation'
    } finally { $limit.Dispose() }
    Assert-Equal 'native failed upgrade preserves every old executable byte' ((Get-FileHash -LiteralPath $limitedDest -Algorithm SHA256).Hash) $beforeLimitedHash
    & $limitedDest
    Assert-Equal 'old executable still runs after failed staging write' ([string]$LASTEXITCODE) '0'
    Assert-Equal 'failed staging write cleans its private partial file' ([string](@(Get-ChildItem -LiteralPath $testRoot -Filter '.s2p-install-*' -Force).Count)) '0'
  } else { Write-Host 'SKIP Linux native file-size-limit publication failure (non-Linux host)' }

  # Hold a real, non-shared destination handle on Windows to reject replacement.
  if ($env:OS -eq 'Windows_NT') {
    $held = [IO.File]::Open($installed, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
      Assert-Throws 'locked destination write fails' {
        Install-Artifact -BaseUrl "$base/upgrade-payload" -ShaUrl "$base/upgrade.sha256" -DestPath $installed -OwnerParam fixture -RepoParam fixture -VersionParam v2 -Require
      } 'Could not publish installation'
    } finally { $held.Dispose() }
    Assert-Equal 'failed locked publication preserves the old executable' ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToLowerInvariant()) $digest
    Assert-Equal 'failed locked publication cleans its private stage' ([string](@(Get-ChildItem -LiteralPath $testRoot -Filter '.s2p-install-*.stage' -Force).Count)) '0'
  } else { Write-Host 'SKIP Windows file-sharing write failure (non-Windows host)' }

  if ((Get-Command git -ErrorAction SilentlyContinue) -and (Get-Command bun -ErrorAction SilentlyContinue)) {
    # The actual build task writes an artifact from checked-out source. This fixture is
    # deliberately tiny and dependency-free; it does not claim to build a Windows PE.
    $fixtureRepo = Join-Path $testRoot 'source'
    git init --quiet -b main $fixtureRepo
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize Git fixture' }
    function Invoke-FixtureGit {
      git -C $fixtureRepo @args | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Git fixture command failed: $args" }
    }
    Invoke-FixtureGit config user.name 's2p installer tests'
    Invoke-FixtureGit config user.email 'installer-tests@example.invalid'
    $package = '{"name":"s2p-installer-fixture","version":"1.0.0","scripts":{"build:win-x64":"bun build.js"}}'
    $build = 'import { mkdirSync, readFileSync, writeFileSync } from "node:fs"; mkdirSync("dist", { recursive: true }); writeFileSync("dist/s2p-windows-x64.exe", readFileSync("version.txt"));'
    [IO.File]::WriteAllText((Join-Path $fixtureRepo 'package.json'), $package, [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $fixtureRepo 'build.js'), $build, [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $fixtureRepo 'version.txt'), 'release-one', [Text.Encoding]::ASCII)
    Invoke-FixtureGit add package.json build.js version.txt
    Invoke-FixtureGit commit --quiet -m 'release fixture'
    Invoke-FixtureGit tag v1
    $releaseCommit = git -C $fixtureRepo rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve fixture commit' }
    [IO.File]::WriteAllText((Join-Path $fixtureRepo 'version.txt'), 'default-branch', [Text.Encoding]::ASCII)
    Invoke-FixtureGit add version.txt
    Invoke-FixtureGit commit --quiet -m 'default branch differs'
    Invoke-FixtureGit branch v1
    Invoke-FixtureGit branch branch-only
    [IO.File]::WriteAllText((Join-Path $fixtureRepo 'build.js'), ($build + ' process.exit(23);'), [Text.Encoding]::ASCII)
    Invoke-FixtureGit add build.js
    Invoke-FixtureGit commit --quiet -m 'failed build leaves output'
    Invoke-FixtureGit tag failed-build
    $badInstall = '{"name":"s2p-installer-fixture","version":"1.0.0","scripts":{"postinstall":"bun -e \"process.exit(23)\"","build:win-x64":"bun build.js"}}'
    [IO.File]::WriteAllText((Join-Path $fixtureRepo 'package.json'), $badInstall, [Text.Encoding]::ASCII)
    Invoke-FixtureGit add package.json
    Invoke-FixtureGit commit --quiet -m 'failed dependency install'
    Invoke-FixtureGit tag failed-install

    $oldConfig = $env:GIT_CONFIG_GLOBAL
    $oldNoSystem = $env:GIT_CONFIG_NOSYSTEM
    $config = Join-Path $testRoot 'gitconfig'
    $repoUri = [Uri]::new([IO.Path]::GetFullPath($fixtureRepo) + [IO.Path]::DirectorySeparatorChar).AbsoluteUri
    git config --file $config "url.$repoUri.insteadOf" 'https://github.com/fixture/fixture.git'
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure local Git transport' }
    $env:GIT_CONFIG_GLOBAL = $config
    $env:GIT_CONFIG_NOSYSTEM = '1'
    try {
      $sourceDest = Join-Path $testRoot 'source-install.exe'
      $messages = @(Install-Artifact -BaseUrl "$base/payload" -ShaUrl "$base/invalid.sha256" -DestPath $sourceDest -OwnerParam fixture -RepoParam fixture -VersionParam v1 -SourceRequested 6>&1)
      Assert-Equal 'explicit source build uses tag, not same-named branch' ([IO.File]::ReadAllText($sourceDest)) 'release-one'
      Assert-Equal 'source provenance records exact commit' ([string](($messages -join "`n") -match [regex]::Escape($releaseCommit))) 'True'
      Assert-Equal 'source artifact is never release-checksum verified' ([string](($messages -join "`n") -notmatch 'Checksum verified')) 'True'
      Install-Artifact -BaseUrl "$base/missing" -ShaUrl "$base/invalid.sha256" -DestPath $sourceDest -OwnerParam fixture -RepoParam fixture -VersionParam v1
      Assert-Equal 'missing binary fallback builds requested tag' ([IO.File]::ReadAllText($sourceDest)) 'release-one'
      Build-From-Source -OwnerParam fixture -RepoParam fixture -VersionParam $releaseCommit -OutFile $sourceDest
      Assert-Equal 'full commit source build is pinned' ([IO.File]::ReadAllText($sourceDest)) 'release-one'
      Push-Location $testRoot
      try { Build-From-Source -OwnerParam fixture -RepoParam fixture -VersionParam v1 -OutFile 'relative-source.exe' }
      finally { Pop-Location }
      Assert-Equal 'relative source output follows PowerShell location' ([IO.File]::ReadAllText((Join-Path $testRoot 'relative-source.exe'))) 'release-one'
      foreach ($ref in @('missing-tag', 'branch-only')) {
        Assert-Throws "$ref refuses default-branch source fallback" {
          Build-From-Source -OwnerParam fixture -RepoParam fixture -VersionParam $ref -OutFile $sourceDest
        } 'Could not fetch requested release ref'
        Assert-Equal "$ref preserves destination" ([IO.File]::ReadAllText($sourceDest)) 'release-one'
      }
      Assert-Throws 'failed native build rejects existing output' {
        Build-From-Source -OwnerParam fixture -RepoParam fixture -VersionParam failed-build -OutFile $sourceDest
      } 'Source build failed'
      Assert-Equal 'failed build preserves destination' ([IO.File]::ReadAllText($sourceDest)) 'release-one'
      Assert-Throws 'failed native dependency install is fatal' {
        Build-From-Source -OwnerParam fixture -RepoParam fixture -VersionParam failed-install -OutFile $sourceDest
      } 'Dependency installation failed'
    } finally {
      $env:GIT_CONFIG_GLOBAL = $oldConfig
      $env:GIT_CONFIG_NOSYSTEM = $oldNoSystem
    }
  } else { Write-Host 'SKIP pinned-source tests (git and Bun required)' }

  # Invoke the actual script in a separate shell: exceptions must reach the process exit.
  $shell = (Get-Process -Id $PID).Path
  $oldErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $cliLog = @(& $shell -NoProfile -NonInteractive -File $installer -Version v1 -Verify -FromSource -Dest (Join-Path $testRoot 'cli') -NoPathUpdate 2>&1)
    $cliCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $oldErrorPreference }
  Assert-Equal 'actual installer exits nonzero for Verify plus FromSource' ([string]($cliCode -ne 0)) 'True'
  Assert-Equal 'actual installer reports incompatible verification mode' ([string](($cliLog -join "`n") -match '(?s)checksum comparison.*source build')) 'True'
  Assert-Equal 'actual installer does not print completion on failure' ([string](($cliLog -join "`n") -notmatch 'Done\. Run:|\[ok\] Installed')) 'True'
} finally {
  Stop-Job $server
  Write-Host "Integrity fixtures retained at $testRoot"
}

if ($env:OS -eq 'Windows_NT') {
$realBefore = Get-RawPath ([Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'))
$fixture = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(
  'Software\s2p-install-test-' + [Guid]::NewGuid().ToString('N'),
  [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,
  [Microsoft.Win32.RegistryOptions]::Volatile)

function New-Case {
  param([string]$Name, $Value, [Microsoft.Win32.RegistryValueKind]$Kind = 'String')
  $key = $fixture.CreateSubKey($Name, [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,
    [Microsoft.Win32.RegistryOptions]::Volatile)
  if ($null -ne $Value) { $key.SetValue('Path', $Value, $Kind) }
  return $key
}

$dir = Join-Path $env:LOCALAPPDATA 'Programs\s2p\bin'

$raw = '%USERPROFILE%\AppData\Local\Microsoft\WindowsApps; %LOCALAPPDATA%\Programs\Tool ;;C:\Plain'
$key = New-Case 'expandable' $raw 'ExpandString'
Ensure-DestOnPath -Dir $dir -EnvKey $key -NoBroadcast
Assert-Equal 'expandable PATH keeps its text, spacing and REG_EXPAND_SZ' (Get-RawPath $key) "ExpandString|$raw;$dir"

$key = New-Case 'plain' 'C:\One;C:\Two' 'String'
Ensure-DestOnPath -Dir $dir -EnvKey $key -NoBroadcast
Assert-Equal 'plain PATH stays REG_SZ' (Get-RawPath $key) "String|C:\One;C:\Two;$dir"

$key = New-Case 'missing' $null
Ensure-DestOnPath -Dir $dir -EnvKey $key -NoBroadcast
Assert-Equal 'missing PATH is created holding the destination' (Get-RawPath $key) "ExpandString|$dir"

$raw = 'C:\One;%LOCALAPPDATA%\Programs\s2p\bin\;C:\Two'
$key = New-Case 'present' $raw 'ExpandString'
Ensure-DestOnPath -Dir $dir -EnvKey $key -NoBroadcast
Assert-Equal 'destination already present in unexpanded form is not added again' (Get-RawPath $key) "ExpandString|$raw"

$key = New-Case 'trailing' 'C:\One;' 'ExpandString'
Ensure-DestOnPath -Dir $dir -EnvKey $key -NoBroadcast
Assert-Equal 'trailing separator is not doubled' (Get-RawPath $key) "ExpandString|C:\One;$dir"

$key = New-Case 'dword' 7 'DWord'
Ensure-DestOnPath -Dir $dir -EnvKey $key -NoBroadcast
Assert-Equal 'non-string PATH is left alone' (Get-RawPath $key) 'DWord|7'

Assert-Equal 'environment change broadcast compiles and runs' ([string](Send-EnvironmentChange)) 'True'

$realAfter = Get-RawPath ([Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'))
Assert-Equal 'real user PATH unchanged' ([string]($realAfter -ceq $realBefore)) 'True'
} else { Write-Host 'SKIP Windows registry and environment broadcast checks (non-Windows host)' }

Write-Host ("PowerShell {0}: {1} check(s), {2} failure(s)" -f $PSVersionTable.PSVersion, $script:checks, $script:failures)
if ($script:failures -gt 0) { exit 1 }
