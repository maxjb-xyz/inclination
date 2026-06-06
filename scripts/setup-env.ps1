#!/usr/bin/env pwsh
# Configure .env for a self-hosted deployment (Windows / PowerShell host).
#
# Mirrors scripts/setup-env.sh:
# - Copies .env.example -> .env if absent.
# - Generates strong random secrets for JWT_ACCESS_SECRET, POSTGRES_PASSWORD,
#   MINIO_ROOT_PASSWORD, S3_SECRET_KEY, keeping DATABASE_URL + S3 creds consistent.
# - Leaves already-configured (non-default, non-empty) secrets untouched.
#
# Usage:  pwsh scripts/setup-env.ps1   (or right-click > Run with PowerShell)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = '.env'
$exampleFile = '.env.example'
$devPw = 'inclination_dev_pw'
$devSecret = 'dev_access_secret_change_me'

function New-Secret {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  # URL-safe base64, no padding.
  ([Convert]::ToBase64String($bytes)) -replace '\+', '-' -replace '/', '_' -replace '=', ''
}

if (-not (Test-Path $exampleFile)) {
  Write-Error "$exampleFile not found (run from the repo root)."
}

if (-not (Test-Path $envFile)) {
  Copy-Item $exampleFile $envFile
  Write-Host "Created $envFile from $exampleFile."
} else {
  Write-Host "$envFile already exists; updating only blank/default secrets."
}

# Read lines, preserving order. We rewrite in-place at the end.
$lines = Get-Content $envFile

function Get-EnvValue([string]$key) {
  $line = $lines | Where-Object { $_ -match "^$([regex]::Escape($key))=" } | Select-Object -First 1
  if ($null -eq $line) { return '' }
  return ($line -replace "^$([regex]::Escape($key))=", '')
}

function Set-EnvValue([string]$key, [string]$val) {
  $script:found = $false
  $script:lines = $script:lines | ForEach-Object {
    if ($_ -match "^$([regex]::Escape($key))=") { $script:found = $true; "$key=$val" } else { $_ }
  }
  if (-not $script:found) { $script:lines += "$key=$val" }
}

function Test-NeedsValue([string]$val) {
  return ([string]::IsNullOrEmpty($val)) -or ($val -eq $devPw) -or ($val -eq $devSecret)
}

# --- JWT signing secret ---
if (Test-NeedsValue (Get-EnvValue 'JWT_ACCESS_SECRET')) {
  Set-EnvValue 'JWT_ACCESS_SECRET' (New-Secret); Write-Host '  set JWT_ACCESS_SECRET'
} else { Write-Host '  kept JWT_ACCESS_SECRET (already configured)' }

# --- Postgres password (+ DATABASE_URL) ---
$pgUser = Get-EnvValue 'POSTGRES_USER'; if (-not $pgUser) { $pgUser = 'inclination' }
$pgDb = Get-EnvValue 'POSTGRES_DB'; if (-not $pgDb) { $pgDb = 'inclination' }
if (Test-NeedsValue (Get-EnvValue 'POSTGRES_PASSWORD')) {
  $pgPw = New-Secret
  Set-EnvValue 'POSTGRES_PASSWORD' $pgPw
  Set-EnvValue 'DATABASE_URL' "postgresql://${pgUser}:${pgPw}@postgres:5432/${pgDb}?schema=public"
  Write-Host '  set POSTGRES_PASSWORD + DATABASE_URL'
} else { Write-Host '  kept POSTGRES_PASSWORD (already configured)' }

# --- MinIO root password (= S3 secret key) ---
if (Test-NeedsValue (Get-EnvValue 'MINIO_ROOT_PASSWORD')) {
  $minioPw = New-Secret
  Set-EnvValue 'MINIO_ROOT_PASSWORD' $minioPw
  Set-EnvValue 'S3_SECRET_KEY' $minioPw
  Write-Host '  set MINIO_ROOT_PASSWORD + S3_SECRET_KEY'
} else { Write-Host '  kept MINIO_ROOT_PASSWORD (already configured)' }

$minioUser = Get-EnvValue 'MINIO_ROOT_USER'; if (-not $minioUser) { $minioUser = 'inclination' }
Set-EnvValue 'S3_ACCESS_KEY' $minioUser

# Write back with LF endings (consumed by Linux containers).
$content = ($lines -join "`n") + "`n"
[System.IO.File]::WriteAllText((Join-Path $root $envFile), $content)

Write-Host ''
Write-Host "Done. Review $envFile, then: docker compose up -d --build"
