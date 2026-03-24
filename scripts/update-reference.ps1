[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/GameTora.Reference.ps1')

$summary = Update-UmamusumeReference -Force:$Force

Write-Host ''
Write-Host 'Update complete.' -ForegroundColor Green
Write-Host ('Raw datasets synced : {0}' -f $summary.rawDatasetCount)
Write-Host ('Normalized entities : {0}' -f $summary.normalizedEntityCount)
Write-Host ('Visual assets       : {0}' -f $summary.assetCount)
Write-Host ('Asset failures      : {0}' -f $summary.assetFailureCount)
Write-Host ('App output         : {0}' -f $summary.appEntry)
