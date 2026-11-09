$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ws = New-Object -ComObject WScript.Shell
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Student Work Scanner.lnk'
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = "$env:ComSpec"
$s.Arguments = "/c """"$here\Start Scanner.cmd"""""
$s.WorkingDirectory = Split-Path -Parent $here
$s.IconLocation = "$here\scanner.ico,0"
$s.Description = 'Start the Student Work Scanner and open it in the browser'
$s.Save()
Write-Host "Made $lnk"
Write-Host "Right-click it, choose Show more options, then Pin to taskbar."
