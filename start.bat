@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo   蟳埔花事 · Xunpu Blossom
echo   ---------------------------------------------
echo.

rem 便携包自带运行时，优先用它
set "NODE=node"
if exist "runtime\node.exe" set "NODE=runtime\node.exe"

rem 屏蔽外部 NODE_OPTIONS，避免某些开发工具全局注入 --require 导致启动失败
set "NODE_OPTIONS="

"%NODE%" -v >nul 2>&1
if errorlevel 1 (
  echo   [x] 没找到 Node.js
  echo.
  echo       请先安装 Node.js 22.5 或更高版本：
  echo       https://nodejs.org
  echo.
  echo       下载 LTS 版，一路「下一步」装完，再双击本文件。
  echo.
  pause
  exit /b 1
)

"%NODE%" -e "const p=process.versions.node.split('.').map(Number);process.exit(p[0]>22||(p[0]===22&&p[1]>=5)?0:1)"
if errorlevel 1 (
  echo   [x] Node.js 版本太旧：
  "%NODE%" -v
  echo.
  echo       需要 22.5 或更高版本，请到 https://nodejs.org 更新。
  echo.
  pause
  exit /b 1
)

set NODE_ENV=production
set HOST=127.0.0.1
set PORT=3000

echo   运行版本  :
"%NODE%" -v
echo   网站      : http://localhost:3000
echo   管理后台  : http://localhost:3000/admin/
echo   默认账号  : admin / xunpu2026
echo.
echo   按 Ctrl+C 可停止服务
echo.

start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:3000"

"%NODE%" --disable-warning=ExperimentalWarning server\index.js

echo.
echo   服务已停止。
pause
