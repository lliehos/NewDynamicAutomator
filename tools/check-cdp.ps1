Start-Sleep -Seconds 2
try {
  $v = Invoke-RestMethod -Uri 'http://127.0.0.1:9222/json/version' -TimeoutSec 5
  $v | ConvertTo-Json
} catch {
  Write-Host ("version fail: " + $_.Exception.Message)
}
try {
  $tabs = Invoke-RestMethod -Uri 'http://127.0.0.1:9222/json' -TimeoutSec 5
  Write-Host ("tabs: " + $tabs.Count)
  $tabs | Select-Object -First 10 title, url, type | Format-Table -AutoSize
} catch {
  Write-Host ("tabs fail: " + $_.Exception.Message)
}
