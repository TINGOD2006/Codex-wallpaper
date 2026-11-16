$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$project=Split-Path $PSScriptRoot
$fixture=Join-Path $project ('.state/thumbnail-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
foreach($size in @(@{width=1080;height=540;expectedWidth=320;expectedHeight=160},@{width=192;height=96;expectedWidth=192;expectedHeight=96})){
 $source=Join-Path $fixture ('source-'+$size.width+'.jpg')
 $output=Join-Path $fixture ('preview-'+$size.width+'.jpg')
 $bitmap=[Drawing.Bitmap]::new($size.width,$size.height)
 try{$bitmap.Save($source,[Drawing.Imaging.ImageFormat]::Jpeg)}finally{$bitmap.Dispose()}
 & (Join-Path $project 'scripts/wallpaper-thumbnail.ps1') -ImagePath $source -OutputPath $output
 $preview=[Drawing.Image]::FromFile($output)
 try{
  if($preview.Width -ne $size.expectedWidth -or $preview.Height -ne $size.expectedHeight){
   throw "Expected $($size.expectedWidth)x$($size.expectedHeight), got $($preview.Width)x$($preview.Height)"
  }
 }finally{$preview.Dispose()}
}
'PASS: large JPEG preserves aspect ratio and small JPEG is not upscaled'
