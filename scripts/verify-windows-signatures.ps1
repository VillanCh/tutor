param([Parameter(Mandatory = $true, Position = 0)][string]$Manifest)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$Files = @(Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json)
if ($Files.Count -lt 2) { throw 'Application and installer paths are required' }
$records = @()
$expectedThumbprint = $null
foreach ($file in $Files) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
        throw "Invalid Authenticode signature or timestamp: $([IO.Path]::GetFileName($file)) ($($signature.Status))"
    }
    $thumbprint = $signature.SignerCertificate.Thumbprint
    if ($expectedThumbprint -and $thumbprint -ne $expectedThumbprint) { throw 'Application and installer signer mismatch' }
    $expectedThumbprint = $thumbprint
    $records += [PSCustomObject]@{ file = [IO.Path]::GetFileName($file); status = 'Valid'; subject = $signature.SignerCertificate.Subject; thumbprint = $thumbprint; timestampSubject = $signature.TimeStamperCertificate.Subject }
}
ConvertTo-Json -InputObject $records -Depth 4 -Compress
