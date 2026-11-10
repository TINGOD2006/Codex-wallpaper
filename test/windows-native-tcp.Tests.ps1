$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/windows-session.ps1')
$ipv4=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$ipv4.Start()
$ipv6=$null;$client=$null;$accepted=$null
try{
 $port=$ipv4.LocalEndpoint.Port
 $client=[Net.Sockets.TcpClient]::new();$client.Connect([Net.IPAddress]::Loopback,$port);$accepted=$ipv4.AcceptTcpClient()
 $rows=@(Get-ThemeBoundEndpoints -LocalPort $port)
 if($rows.Count -ne 1 -or $rows[0].OwningProcess -ne $PID -or $rows[0].LocalAddress -ne '127.0.0.1' -or $rows[0].RemotePort -ne 0){throw 'IPv4 listener ownership or port byte order incorrect; established connection leaked'}
 if(@(Get-ThemeBoundEndpoints -OwningProcess 2147483647|Where-Object LocalPort -eq $port).Count){throw 'Foreign process filter accepted an owned listener'}
 $ipv6=[Net.Sockets.TcpListener]::new([Net.IPAddress]::IPv6Loopback,$port);$ipv6.Server.DualMode=$false;$ipv6.Start()
 $rows=@(Get-ThemeBoundEndpoints -LocalPort $port)
 if($rows.Count -ne 2 -or @($rows|Where-Object {$_.LocalAddress -eq '::1' -and $_.OwningProcess -eq $PID}).Count -ne 1){throw 'IPv6 listener or same-port ambiguity was lost'}
 $created=[DateTime]::UtcNow;$identity=@{pid=$PID;startTime=$created.Ticks.ToString();appPath='C:\Owned\ChatGPT.exe';mode='Existing';port=$port}
 $process=@{ProcessId=$PID;CreationDate=$created;ExecutablePath=$identity.appPath;CommandLine='ChatGPT.exe --remote-debugging-port=0'}
 if(Test-ThemeIdentity $identity $process $rows -RequirePort){throw 'Ambiguous IPv4/IPv6 listener accepted'}
 $ipv6.Stop();$ipv4.Stop()
 if(@(Get-ThemeBoundEndpoints -LocalPort $port).Count){throw 'Closed listener was returned from stale cache'}
 'PASS: fresh native IPv4/IPv6 PID ownership, network-order ports, active connections excluded, ambiguity and closed listeners rejected'
}finally{if($accepted){$accepted.Dispose()};if($client){$client.Dispose()};if($ipv6){$ipv6.Stop()};$ipv4.Stop()}
