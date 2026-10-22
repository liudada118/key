param([Parameter(Mandatory = $true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$mutex = $null
$owned = $false
$exitCode = 0
try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $expected = @('schemaVersion', 'binaryPath', 'baseDirectory', 'dataDirectory', 'port', 'startupTimeoutSeconds')
    if ($config.schemaVersion -ne 1 -or @($config.PSObject.Properties.Name | Where-Object { $_ -notin $expected }).Count -gt 0) { throw 'INVALID_CONFIG' }
    foreach ($key in @('binaryPath', 'baseDirectory', 'dataDirectory')) {
        if (-not [IO.Path]::IsPathRooted($config.$key) -or $config.$key.Contains('"')) { throw 'ABSOLUTE_PATH_REQUIRED' }
    }
    $binary = [IO.Path]::GetFullPath($config.binaryPath)
    $base = [IO.Path]::GetFullPath($config.baseDirectory)
    $data = [IO.Path]::GetFullPath($config.dataDirectory)
    $port = [int]$config.port
    $timeout = [int]$config.startupTimeoutSeconds
    if ($port -lt 1024 -or $port -gt 65535 -or $timeout -lt 5 -or $timeout -gt 60) { throw 'INVALID_STARTUP_LIMITS' }
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf) -or [IO.Path]::GetFileName($binary) -ne 'mysqld.exe') { throw 'MYSQL_BINARY_MISSING' }
    if ([IO.Path]::GetFullPath((Join-Path $base 'bin\mysqld.exe')) -ne $binary) { throw 'MYSQL_BASE_DIRECTORY_MISMATCH' }
    if (-not (Test-Path -LiteralPath (Join-Path $data 'mysql.ibd') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $data 'auto.cnf') -PathType Leaf)) { throw 'EXISTING_MYSQL_DATA_REQUIRED' }
    $mutex = [Threading.Mutex]::new($false, "Local\KeyManagerLocalMySQL-$port")
    try { $owned = $mutex.WaitOne(($timeout + 5) * 1000) } catch [Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { throw 'MYSQL_STARTUP_BUSY' }
    function Test-MySQLPort {
        $client = [Net.Sockets.TcpClient]::new()
        try {
            $attempt = $client.ConnectAsync('127.0.0.1', $port)
            return $attempt.Wait(300) -and $client.Connected
        } catch { return $false } finally { $client.Dispose() }
    }
    if (Test-MySQLPort) {
        Write-Output '[Local MySQL] Port is already listening; no duplicate process started.'
    } else {
        $prefix = Join-Path (Split-Path -Parent $data) ('key-manager-start-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        $arguments = @('--no-defaults', "--basedir=`"$base`"", "--datadir=`"$data`"", "--port=$port", '--bind-address=127.0.0.1', '--mysqlx=OFF', '--console')
        $child = Start-Process -FilePath $binary -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput "$prefix.out.log" -RedirectStandardError "$prefix.err.log"
        $deadline = [DateTime]::UtcNow.AddSeconds($timeout)
        while (-not (Test-MySQLPort)) {
            if ([DateTime]::UtcNow -ge $deadline) { throw 'MYSQL_STARTUP_TIMEOUT' }
            Start-Sleep -Milliseconds 250
        }
        Write-Output "[Local MySQL] Ready on 127.0.0.1:$port; launcher PID $($child.Id)."
    }
} catch {
    [Console]::Error.WriteLine('[Local MySQL] Startup failed. Check the existing-data paths and key-manager-start logs. Data was not initialized or reset.')
    $exitCode = 1
} finally {
    if ($owned) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
exit $exitCode
