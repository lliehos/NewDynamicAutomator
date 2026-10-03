$ErrorActionPreference = 'Continue'
$base = 'https://localhost:7201'
$urls = @(
  '/extension/install-path',
  '/extension/download/global',
  '/extension/download/smart',
  '/extension/installer/global',
  '/Panel/Extension/Install',
  '/Panel/Home/Processes'
)
foreach ($u in $urls) {
  $req = [System.Net.HttpWebRequest]::Create($base + $u)
  $req.AllowAutoRedirect = $false
  $req.ServerCertificateValidationCallback = { $true }
  $req.Timeout = 20000
  $req.Method = 'GET'
  try {
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $ct = $resp.ContentType
    $len = $resp.ContentLength
    $loc = $resp.Headers['Location']
    Write-Output ("{0,-38} -> {1}  ct={2}  len={3}  loc={4}" -f $u, $code, $ct, $len, $loc)
    $resp.Close()
  } catch [System.Net.WebException] {
    $r = $_.Exception.Response
    if ($r) {
      Write-Output ("{0,-38} -> {1}  loc={2}" -f $u, [int]$r.StatusCode, $r.Headers['Location'])
    } else {
      Write-Output ("{0,-38} -> ERR {1}" -f $u, $_.Exception.Message)
    }
  }
}
