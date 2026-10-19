# Minimal read-only validator. Compatible with PowerShell 7+.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$docs = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $docs
$files = @(Get-ChildItem -LiteralPath $docs -Filter '*.md' -Recurse -File)
$files += Get-Item -LiteralPath (Join-Path $root 'README.md')
$files += Get-Item -LiteralPath (Join-Path $root 'AGENTS.md')
$errors = [System.Collections.Generic.List[string]]::new()
$links = 0
$jsonExamples = 0

$required = @('README.md','PRD.md','BUSINESS_RULES.md','ARCHITECTURE.md',
             'DATABASE.md','API.md','DESIGN.md','SECURITY.md','BACKLOG.md',
             'QUALITY.md','PROJECT_STATE.md','DECISIONS.md')
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $docs $name))) {
    $errors.Add("Missing required document: docs/$name")
  }
}

foreach ($file in $files) {
  $body = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
  $fences = [regex]::Matches($body, '(?m)^\s*```').Count
  if ($fences % 2 -ne 0) { $errors.Add("Unbalanced code fences: $($file.FullName)") }
  foreach ($m in [regex]::Matches($body, '\[[^\]]*\]\(([^)]+)\)')) {
    $target = $m.Groups[1].Value.Trim('<','>')
    if ($target -match '^(https?://|mailto:|#)') { continue }
    $target = ($target -split '#',2)[0]
    if (-not $target) { continue }
    $links++
    $resolved = [System.IO.Path]::GetFullPath((Join-Path $file.DirectoryName $target))
    if (-not (Test-Path -LiteralPath $resolved)) { $errors.Add("Broken link in $($file.Name): $target") }
  }
  foreach ($m in [regex]::Matches($body, '(?s)```json\s*\r?\n(.*?)\r?\n```')) {
    try { $null = $m.Groups[1].Value | ConvertFrom-Json -ErrorAction Stop; $jsonExamples++ }
    catch { $errors.Add("Invalid JSON in $($file.Name): $($_.Exception.Message)") }
  }
}

$backlog = Get-Content -LiteralPath (Join-Path $docs 'BACKLOG.md') -Raw -Encoding UTF8
$defined = @([regex]::Matches($backlog, '(?m)^## EPIC-(0[1-6]) —') | ForEach-Object { $_.Groups[1].Value })
if ($defined.Count -ne 6 -or (@($defined | Sort-Object -Unique)).Count -ne 6) {
  $errors.Add('BACKLOG.md must define exactly six EPIC-01..EPIC-06 headers')
}
for ($i=1; $i -le 6; $i++) {
  $epic = ('EPIC-{0:D2}' -f $i)
  $header = "## $epic —"
  $start = $backlog.IndexOf($header, [StringComparison]::Ordinal)
  if ($start -lt 0) { continue }
  $next = $backlog.IndexOf('## EPIC-', $start + $header.Length, [StringComparison]::Ordinal)
  if ($next -lt 0) { $next = $backlog.IndexOf('## Agent execution protocol', $start, [StringComparison]::Ordinal) }
  if ($next -lt 0) { $next = $backlog.Length }
  $section = $backlog.Substring($start, $next-$start)
  foreach ($j in 1..5) {
    $code = ('**A{0:D2}**' -f $j)
    if (-not $section.Contains($code)) { $errors.Add("$epic missing acceptance $code") }
  }
}

# Detect any accidental extra epic definitions anywhere in the docs.
foreach ($file in $files) {
  $body = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
  foreach ($m in [regex]::Matches($body, '\bEPIC-\d{2}\b')) {
    $n = [int]($m.Value.Substring(5))
    if ($n -lt 1 -or $n -gt 6) { $errors.Add("Unknown epic $($m.Value) in $($file.Name)") }
  }
}

Write-Output "Docs: $($files.Count) Markdown files; $links relative links; $jsonExamples JSON examples."
if ($errors.Count) { $errors | ForEach-Object { Write-Output "FAIL: $_" }; exit 1 }
Write-Output 'PASS: docs structure. This does not prove implementation or semantic correctness.'
exit 0
