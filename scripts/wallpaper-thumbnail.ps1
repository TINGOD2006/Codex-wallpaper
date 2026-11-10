param([string]$ImagePath,[string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$image=$null;$bitmap=$null;$graphics=$null
try{
  $image=[Drawing.Image]::FromFile($ImagePath)
  if($image.Width -gt 20000 -or $image.Height -gt 20000){throw 'Preview dimensions exceed limit'}
  $ratio=[math]::Min(1,320/[math]::Max($image.Width,$image.Height))
  $bitmap=[Drawing.Bitmap]::new([math]::Max(1,[int]($image.Width*$ratio)),[math]::Max(1,[int]($image.Height*$ratio)))
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([Drawing.Color]::FromArgb(24,24,24))
  $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($image,0,0,$bitmap.Width,$bitmap.Height)
  $bitmap.Save($OutputPath,[Drawing.Imaging.ImageFormat]::Jpeg)
}finally{if($graphics){$graphics.Dispose()};if($bitmap){$bitmap.Dispose()};if($image){$image.Dispose()}}
