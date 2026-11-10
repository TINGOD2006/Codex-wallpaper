$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'companion-worker.ps1') -Integrated
