param(
  [Parameter(Mandatory=$true)][string]$WsUrl,
  [Parameter(Mandatory=$true)][string]$Expression,
  [switch]$AwaitPromise
)

Add-Type -AssemblyName System.Net.Http
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$cts = [System.Threading.CancellationTokenSource]::new()
$cts.CancelAfter([TimeSpan]::FromSeconds(20))
$uri = [Uri]$WsUrl
$ws.ConnectAsync($uri, $cts.Token).Wait()

function Send-Cdp($id, $method, $params) {
  $obj = @{ id = $id; method = $method }
  if ($null -ne $params) { $obj.params = $params }
  $json = ($obj | ConvertTo-Json -Depth 20 -Compress)
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $seg = [ArraySegment[byte]]::new($bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).Wait()
}

function Recv-Cdp($wantId) {
  $buffer = New-Object byte[] 1048576
  while ($true) {
    $ms = New-Object System.IO.MemoryStream
    do {
      $seg = [ArraySegment[byte]]::new($buffer)
      $result = $ws.ReceiveAsync($seg, $cts.Token).Result
      $ms.Write($buffer, 0, $result.Count)
    } while (-not $result.EndOfMessage)
    $text = [Text.Encoding]::UTF8.GetString($ms.ToArray())
    $msg = $text | ConvertFrom-Json
    if ($null -ne $msg.id -and [int]$msg.id -eq $wantId) { return $msg }
  }
}

Send-Cdp 1 'Runtime.enable' $null
[void](Recv-Cdp 1)

$params = @{
  expression = $Expression
  returnByValue = $true
  awaitPromise = [bool]$AwaitPromise
}
Send-Cdp 2 'Runtime.evaluate' $params
$res = Recv-Cdp 2
$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'bye', $cts.Token).Wait()
$res | ConvertTo-Json -Depth 30
