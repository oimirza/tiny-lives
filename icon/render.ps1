# Renders icon/icon.svg to the PNG app icons in public/ using headless Edge.
# Usage: powershell -File icon/render.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$svg = Get-Content (Join-Path $PSScriptRoot 'icon.svg') -Raw -Encoding UTF8
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$tmp = Join-Path $env:TEMP 'tinylives-icon'
New-Item -ItemType Directory -Force $tmp | Out-Null

# name, pixel size, content scale (maskable icons keep the art inside the safe circle)
$jobs = @(
  @('icon-512.png', 512, 1),
  @('icon-192.png', 192, 1),
  @('apple-touch-icon.png', 180, 1),
  @('icon-maskable-512.png', 512, 0.8)
)

foreach ($j in $jobs) {
  $name, $size, $scale = $j
  $html = @"
<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@700&display=block" rel="stylesheet">
<style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:#3c128f}svg{display:block;width:${size}px;height:${size}px}</style>
</head><body>$svg
<script>
(async () => {
  await document.fonts.load('700 150px Fredoka');
  await document.fonts.ready;
  const svg = document.querySelector('svg');
  svg.removeAttribute('width'); svg.removeAttribute('height');
  // centre the crumb and heart over the dotless i of each word
  const fills = [...svg.querySelectorAll('#content text')].slice(2);
  const midX = (t) => { const b = t.getExtentOfChar(1); return b.x + b.width / 2; };
  const crumb = svg.getElementById('iCrumb'), heart = svg.getElementById('iHeart');
  crumb.setAttribute('transform', crumb.getAttribute('transform').replace('CRUMB_X', midX(fills[0]).toFixed(1)));
  heart.setAttribute('transform', heart.getAttribute('transform').replace('HEART_X', midX(fills[1]).toFixed(1)));
  const s = $scale;
  if (s !== 1) svg.getElementById('content').setAttribute('transform', 'translate(' + 256 * (1 - s) + ' ' + 256 * (1 - s) + ') scale(' + s + ')');
  document.title = 'ready';
})();
</script></body></html>
"@
  $page = Join-Path $tmp "$name.html"
  Set-Content -Path $page -Value $html -Encoding UTF8
  $out = Join-Path $root "public\$name"
  & $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=8000 `
    "--window-size=$size,$size" "--screenshot=$out" "file:///$($page -replace '\\','/')" | Out-Null
  Start-Sleep -Milliseconds 500
  "$name -> $((Get-Item $out).Length) bytes"
}
