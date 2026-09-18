# deploy.ps1 —— 建仓 + push + 开 Pages + 验证（需 gh 已登录）
# 用法：powershell -NoProfile -File tools\deploy.ps1 [-Repo diva-web] [-User <github-user>]
param(
  [string]$Repo = 'diva-web',
  [string]$ProjDir = 'D:\OpenClawTemp\diva-web'
)
$ErrorActionPreference = 'Stop'
$env:GH_PAGER = ''
Set-Location $ProjDir

Write-Output '== 1) 认证检查 =='
gh auth status 2>&1 | Write-Output

Write-Output '== 2) 本地提交 =='
git add -A
git -c user.email=dev@local -c user.name=diva commit -m 'diva-web v1' 2>$null
git log --oneline -3 | Write-Output

Write-Output '== 3) 建仓并推送 =='
gh repo create $Repo --public --source . --remote origin --push 2>&1 | Write-Output
if ($LASTEXITCODE -ne 0) {
  git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin main 2>&1 | Write-Output
}

Write-Output '== 4) 开启 Pages（main 分支根目录）=='
$body = '{"source":{"branch":"main","path":"/"}}'
$body | gh api -X POST "repos/{owner}/$Repo/pages" --input - 2>&1 | Write-Output
# 已存在时改为 PUT
$body | gh api -X PUT "repos/{owner}/$Repo/pages" --input - 2>&1 | Write-Output

Write-Output '== 5) 取链接并验证 =='
$u = gh api "repos/{owner}/$Repo/pages" --jq '.html_url' 2>&1
Write-Output "PAGES_URL=$u"
Start-Sleep -Seconds 30
$code = curl.exe -s -o NUL -w '%{http_code}' $u
Write-Output "HTTP=$code"
curl.exe -s $u | Select-String -Pattern 'DIVA-01' | Select-Object -First 2 | Write-Output
