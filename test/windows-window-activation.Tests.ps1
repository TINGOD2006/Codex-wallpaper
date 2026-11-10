$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
. (Join-Path $PSScriptRoot '../scripts/window-activation.ps1')
$form=[Windows.Forms.Form]::new();$form.Text='Wallpaper owned activation fixture';$form.ShowInTaskbar=$true
try{
 $form.Width=640;$form.Height=480;$form.Show();$form.WindowState='Minimized';[Windows.Forms.Application]::DoEvents()
 if(-not [CodexWindowActivation]::ValidMain($form.Handle,$PID)){throw 'Minimized main window was excluded by size'}
 if([CodexWindowActivation]::Find($PID) -ne $form.Handle){throw 'Cannot find minimized fixture main window'}
 if([CodexWindowActivation]::Restore($form.Handle,$PID+100000)){throw 'Accepted incorrect owner'}
 if(-not [CodexWindowActivation]::Restore($form.Handle,$PID)){throw 'Failed owned window activation'}
 for($i=0;$i -lt 30 -and $form.WindowState -eq 'Minimized';$i++){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 20}
 if($form.WindowState -eq 'Minimized'){throw 'Window remains minimized'}
 $form.Hide();[void][CodexWindowActivation]::Restore($form.Handle,$PID)
 for($i=0;$i -lt 30 -and -not $form.Visible;$i++){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 20}
 if(-not $form.Visible){throw 'Window remains hidden'}
 $blank=[Windows.Forms.Form]::new();$blank.Text='';$blank.Width=640;$blank.Height=480
 try{
  [void]$blank.Handle
  if([CodexWindowActivation]::ValidMain($blank.Handle,$PID) -or [CodexWindowActivation]::Restore($blank.Handle,$PID)){throw 'Accepted untitled hidden helper'}
  if($blank.Visible){throw 'Revealed untitled helper'}
 }finally{$blank.Dispose()}
 Write-Output 'PASS: restore minimized/hidden own fixture; reject foreign PID'
}finally{$form.Close();$form.Dispose()}
