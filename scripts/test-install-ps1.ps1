# Windows checks for install.ps1's user PATH update (#9). Run under both shells:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-install-ps1.ps1
#   pwsh -NoProfile -File scripts\test-install-ps1.ps1
# The installer's functions are loaded from its syntax tree, so nothing is downloaded or
# installed. They run against volatile keys under HKCU\Software, which Windows discards at
# sign-out. The real user PATH is read before and after and must not change.
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
function Assert-Equal {
  param([string]$Name, [string]$Actual, [string]$Expected)
  if ($Actual -ceq $Expected) {
    Write-Host "ok   $Name"
  } else {
    $script:failures++
    Write-Host "FAIL $Name`n     expected: $Expected`n     actual:   $Actual"
  }
}

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

Write-Host ("PowerShell {0}: {1} failure(s)" -f $PSVersionTable.PSVersion, $script:failures)
if ($script:failures -gt 0) { exit 1 }
