$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/caption-types.ps1')
Initialize-CaptionTypes
function Rect($l,$t,$r,$b){return [CodexWallpaper.CaptionRect]@{Left=$l;Top=$t;Right=$r;Bottom=$b}}
foreach($scale in @(1,1.25,1.5,2)){
 $w=[int](1280*$scale);$h=[int](800*$scale);$left=-1500;$top=30
 $layout=[CodexWallpaper.NativeCaption]::Calculate((Rect $left $top ($left+$w) ($top+$h)),(Rect ($w-[int](138*$scale)) 0 $w ([int](40*$scale))),$scale)
 if(-not $layout -or $layout.Button.Right -gt $layout.NativeButtons.Left-[int](5*$scale)){throw 'Button overlaps native caption controls'}
 if($layout.Sidebar.Right -gt $layout.Host.Right -or $layout.Sidebar.Left -lt $layout.Host.Left -or $layout.Sidebar.Bottom -gt $layout.Host.Bottom){throw 'Sidebar outside host'}
 if($layout.Button.Left -gt $layout.NativeButtons.Left){throw 'Button is not left of minimize'}
}
if([CodexWallpaper.NativeCaption]::Calculate((Rect 0 0 1280 800),(Rect 0 0 0 0),1)){throw 'Missing caption bounds accepted'}
if([CodexWallpaper.NativeCaption]::Calculate((Rect 0 0 1280 800),(Rect 200 0 338 40),1)){throw 'Unclassified left-side chrome accepted'}
Write-Output 'PASS: caption layout at four DPI scales, negative monitor origin, no native-control overlap and invalid bounds rejected'
