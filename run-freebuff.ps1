$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$repoScript = Join-Path $scriptRoot 'codebuff_repo\run-freebuff.ps1'
if (-not (Test-Path $repoScript)) {
    Write-Error "Could not find codebuff_repo\run-freebuff.ps1. Make sure the repo is in D:\\minipro\\codebuff_repo."
    exit 1
}

powershell -NoProfile -ExecutionPolicy Bypass -File $repoScript @Args
