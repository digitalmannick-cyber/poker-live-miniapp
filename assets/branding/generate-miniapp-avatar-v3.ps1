$ErrorActionPreference = "Stop"
$outPath = "d:\TRAE\xuan\poker-live-miniapp\assets\branding\miniapp-avatar-144-v3.png"
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
$g.Clear([System.Drawing.Color]::FromArgb(255,10,14,22))

$bgRect = New-Object System.Drawing.Rectangle 0,0,144,144
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, [System.Drawing.Color]::FromArgb(255,18,23,35), [System.Drawing.Color]::FromArgb(255,9,12,20), 35)
$g.FillRectangle($bgBrush,$bgRect)

$topBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,55,14,22))
$g.FillPie($topBrush,-34,-28,100,100,0,90)
$linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,20,102,122),1)
for($i=18; $i -le 126; $i+=18){ $g.DrawLine($linePen,$i,0,0,$i) }

$chipRect = New-Object System.Drawing.Rectangle 36,24,72,72
$chipFill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,18,26,40))
$g.FillEllipse($chipFill,$chipRect)
$chipOuterPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,0,196,232), 3)
$chipInnerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,87,104,130), 2)
$g.DrawEllipse($chipOuterPen,$chipRect)
$g.DrawEllipse($chipInnerPen,44,32,56,56)

for($i=0; $i -lt 6; $i++) {
  $angle = $i * 60
  $g.TranslateTransform(72,60)
  $g.RotateTransform($angle)
  $segBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,0,196,232))
  Fill-RoundRect $g $segBrush -4 -31 8 14 3
  $segBrush.Dispose()
  $g.ResetTransform()
}

$shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,8,10,16))
Fill-RoundRect $g $shadowBrush 26 44 40 54 10
Fill-RoundRect $g $shadowBrush 56 34 40 54 10

$leftCardBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,206,42,24))
$rightCardBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,70,86,240))
Fill-RoundRect $g $leftCardBrush 24 42 40 54 10
Fill-RoundRect $g $rightCardBrush 56 32 40 54 10
$cardStroke = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,235,240,248), 1.2)
Stroke-RoundRect $g $cardStroke 24 42 40 54 10
Stroke-RoundRect $g $cardStroke 56 32 40 54 10

$fontRank = New-Object System.Drawing.Font('Microsoft YaHei', 17, [System.Drawing.FontStyle]::Bold)
$fontSuit = New-Object System.Drawing.Font('Segoe UI Symbol', 12, [System.Drawing.FontStyle]::Bold)
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.DrawString('A',$fontRank,$whiteBrush,33,49)
$g.DrawString([char]0x2665,$fontSuit,$whiteBrush,35,73)
$g.DrawString('K',$fontRank,$whiteBrush,65,39)
$g.DrawString([char]0x2660,$fontSuit,$whiteBrush,67,63)

$barBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,0,198,232))
Fill-RoundRect $g $barBrush 30 108 84 7 4
$dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,255,196,0))
$g.FillEllipse($dotBrush,30,106,11,11)

$bgBrush.Dispose(); $topBrush.Dispose(); $linePen.Dispose(); $chipFill.Dispose(); $chipOuterPen.Dispose(); $chipInnerPen.Dispose(); $shadowBrush.Dispose(); $leftCardBrush.Dispose(); $rightCardBrush.Dispose(); $cardStroke.Dispose(); $fontRank.Dispose(); $fontSuit.Dispose(); $whiteBrush.Dispose(); $barBrush.Dispose(); $dotBrush.Dispose()
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output $outPath
