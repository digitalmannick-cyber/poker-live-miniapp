$ErrorActionPreference = "Stop"
$root = "d:\TRAE\xuan\poker-live-miniapp\assets\branding"
New-Item -ItemType Directory -Force -Path $root | Out-Null
$outPath = Join-Path $root "miniapp-avatar-144-pro.png"
Add-Type -AssemblyName System.Drawing

function New-RoundRectPath($x,$y,$w,$h,$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x,$y,$d,$d,180,90)
  $path.AddArc($x+$w-$d,$y,$d,$d,270,90)
  $path.AddArc($x+$w-$d,$y+$h-$d,$d,$d,0,90)
  $path.AddArc($x,$y+$h-$d,$d,$d,90,90)
  $path.CloseFigure()
  return $path
}

function Fill-RoundRect($graphics,$brush,$x,$y,$w,$h,$r) {
  $path = New-RoundRectPath $x $y $w $h $r
  $graphics.FillPath($brush,$path)
  $path.Dispose()
}

function Stroke-RoundRect($graphics,$pen,$x,$y,$w,$h,$r) {
  $path = New-RoundRectPath $x $y $w $h $r
  $graphics.DrawPath($pen,$path)
  $path.Dispose()
}

$bmp = New-Object System.Drawing.Bitmap 144,144
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(255,7,10,16))

$bgRect = New-Object System.Drawing.Rectangle 0,0,144,144
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, [System.Drawing.Color]::FromArgb(255,13,18,28), [System.Drawing.Color]::FromArgb(255,7,10,16), 45)
Fill-RoundRect $g $bgBrush 4 4 136 136 28

$glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$glowPath.AddEllipse(-18,-14,96,96)
$glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
$glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(135,230,0,18)
$glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0,230,0,18))
$g.FillEllipse($glowBrush,-18,-14,96,96)

$strokePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120,0,209,255), 2)
Stroke-RoundRect $g $strokePen 4 4 136 136 28

$chipOuter = New-Object System.Drawing.Rectangle 34,28,76,76
$chipBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($chipOuter, [System.Drawing.Color]::FromArgb(255,19,28,44), [System.Drawing.Color]::FromArgb(255,12,18,30), 90)
$g.FillEllipse($chipBrush,$chipOuter)
$chipPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180,0,209,255), 3)
$g.DrawEllipse($chipPen,$chipOuter)
$innerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(110,255,255,255), 2)
$g.DrawEllipse($innerPen,42,36,60,60)

for($i=0; $i -lt 8; $i++) {
  $angle = $i * 45
  $g.TranslateTransform(72,66)
  $g.RotateTransform($angle)
  $segBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(205,0,209,255))
  Fill-RoundRect $g $segBrush -4 -34 8 12 3
  $segBrush.Dispose()
  $g.ResetTransform()
}

$shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70,0,0,0))
Fill-RoundRect $g $shadowBrush 30 44 42 56 10
Fill-RoundRect $g $shadowBrush 58 36 42 56 10

$redRect = New-Object System.Drawing.Rectangle 26,40,42,56
$blueRect = New-Object System.Drawing.Rectangle 54,32,42,56
$redCardBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($redRect, [System.Drawing.Color]::FromArgb(255,212,33,14), [System.Drawing.Color]::FromArgb(255,173,18,2), 90)
$blueCardBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($blueRect, [System.Drawing.Color]::FromArgb(255,72,93,255), [System.Drawing.Color]::FromArgb(255,46,63,204), 90)
Fill-RoundRect $g $redCardBrush 26 40 42 56 10
Fill-RoundRect $g $blueCardBrush 54 32 42 56 10
$cardStroke = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70,255,255,255),1.5)
Stroke-RoundRect $g $cardStroke 26 40 42 56 10
Stroke-RoundRect $g $cardStroke 54 32 42 56 10

$fontRank = New-Object System.Drawing.Font('Microsoft YaHei', 16, [System.Drawing.FontStyle]::Bold)
$fontSuit = New-Object System.Drawing.Font('Segoe UI Symbol', 12, [System.Drawing.FontStyle]::Bold)
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.DrawString('A',$fontRank,$whiteBrush,36,49)
$g.DrawString([char]0x2665,$fontSuit,$whiteBrush,38,72)
$g.DrawString('K',$fontRank,$whiteBrush,64,41)
$g.DrawString([char]0x2660,$fontSuit,$whiteBrush,67,64)

$accentRect = New-Object System.Drawing.Rectangle 28,102,88,12
$accentBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($accentRect, [System.Drawing.Color]::FromArgb(255,0,209,255), [System.Drawing.Color]::FromArgb(255,92,246,211), 0)
Fill-RoundRect $g $accentBrush 28 104 88 8 4

$bgBrush.Dispose()
$glowBrush.Dispose()
$glowPath.Dispose()
$strokePen.Dispose()
$chipBrush.Dispose()
$chipPen.Dispose()
$innerPen.Dispose()
$shadowBrush.Dispose()
$redCardBrush.Dispose()
$blueCardBrush.Dispose()
$cardStroke.Dispose()
$fontRank.Dispose()
$fontSuit.Dispose()
$whiteBrush.Dispose()
$accentBrush.Dispose()

$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output $outPath
