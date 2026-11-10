function Initialize-CaptionTypes {
 if('CodexWallpaper.NativeCaption' -as [type]){return}
 Add-Type -AssemblyName System.Windows.Forms
 Add-Type -AssemblyName System.Drawing
 Add-Type -AssemblyName UIAutomationClient
 Add-Type -AssemblyName UIAutomationTypes
 Add-Type -AssemblyName WindowsBase
 Add-Type -Path (Join-Path $PSScriptRoot '../src/companion/native-caption.cs') -ReferencedAssemblies @([Windows.Forms.Form].Assembly.Location,[System.ComponentModel.Component].Assembly.Location,[Diagnostics.Process].Assembly.Location,[Windows.Automation.AutomationElement].Assembly.Location,[Windows.Automation.ControlType].Assembly.Location,[Windows.Rect].Assembly.Location,'System.Collections.dll','System.Threading.Tasks.dll')
}
