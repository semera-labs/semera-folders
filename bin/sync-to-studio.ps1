# Copies the plugin into a WordPress Studio site for testing (Studio's PHP only
# sees files inside the site folder, so a symlink would not work).
#   pwsh bin/sync-to-studio.ps1                  # default site: C:\Users\<you>\Studio\semera-dev
#   pwsh bin/sync-to-studio.ps1 -Site C:\path\to\site
param(
	[string]$Site = (Join-Path $env:USERPROFILE 'Studio\semera-dev')
)

$source = Split-Path -Parent $PSScriptRoot
$target = Join-Path $Site 'wp-content\plugins\semera-folders'

robocopy $source $target /MIR /XD .git .claude /XF .gitignore CLAUDE.md /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
Write-Host "Synced to $target"
exit 0
