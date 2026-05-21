$input = [Console]::In.ReadToEnd() | ConvertFrom-Json
$dir = $input.workspace.current_dir
$branch = ""
try {
    $branch = git -C $dir --no-optional-locks rev-parse --abbrev-ref HEAD 2>$null
} catch {}
$time = Get-Date -Format "HH:mm:ss"
$output = ""
if ($dir) { $output += $dir }
if ($branch) { $output += " ($branch)" }
$output += " $time"
Write-Host $output