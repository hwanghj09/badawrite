Add-Type -AssemblyName System.Drawing
$image = New-Object System.Drawing.Bitmap(1400,300)
$drawing = [System.Drawing.Graphics]::FromImage($image)
$drawing.Clear([System.Drawing.Color]::White)
$textFont = New-Object System.Drawing.Font('Arial',28)
$drawing.DrawString('1. Listening practice',$textFont,[System.Drawing.Brushes]::Black,30,25)
$drawing.DrawString('W: Hello, Daniel. How are you today?',$textFont,[System.Drawing.Brushes]::Black,30,100)
$drawing.DrawString('M: I am fine. Thank you very much.',$textFont,[System.Drawing.Brushes]::Black,30,175)
$image.Save((Join-Path $PSScriptRoot 'script.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$drawing.Dispose()
$textFont.Dispose()
$image.Dispose()
if (-not (Test-Path (Join-Path $PSScriptRoot 'script.png'))) { throw 'Fixture not created' }
