param([Parameter(Mandatory = $true, Position = 0)][string]$File)
$ErrorActionPreference = 'Stop'
$names = @('WINDOWS_CODE_SIGN_KEY_VAULT_URI', 'WINDOWS_CODE_SIGN_CLIENT_ID', 'WINDOWS_CODE_SIGN_CLIENT_SECRET', 'WINDOWS_CODE_SIGN_CERT_NAME', 'WINDOWS_CODE_SIGN_TENANT_ID')
foreach ($name in $names) {
    if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing signing setting: $name" }
}
if (-not (Test-Path -LiteralPath $File)) { throw 'Signing target does not exist' }
$tool = Get-Command AzureSignTool -ErrorAction Stop
& $tool.Source sign -kvu $env:WINDOWS_CODE_SIGN_KEY_VAULT_URI -kvi $env:WINDOWS_CODE_SIGN_CLIENT_ID -kvt $env:WINDOWS_CODE_SIGN_TENANT_ID -kvs $env:WINDOWS_CODE_SIGN_CLIENT_SECRET -kvc $env:WINDOWS_CODE_SIGN_CERT_NAME -fd sha256 -tr http://timestamp.digicert.com -td sha256 $File
if ($LASTEXITCODE -ne 0) { throw "AzureSignTool failed: $LASTEXITCODE" }
$signature = Get-AuthenticodeSignature -LiteralPath $File
if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
    throw "Signature/timestamp validation failed: $($signature.Status)"
}
Write-Host "Verified Authenticode signature: $([IO.Path]::GetFileName($File))"
