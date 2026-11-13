@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

title 蟳埔花事 · Xunpu Blossom

echo.
echo   蟳埔花事 · Xunpu Blossom
echo   ---------------------------------------------
echo.

rem 屏蔽外部 NODE_OPTIONS，避免某些开发工具全局注入 --require 导致启动失败
set "NODE_OPTIONS="
if not defined PORT set "PORT=3000"

rem 便携包自带运行时，优先用它
set "NODE=node"
if exist "runtime\node.exe" set "NODE=runtime\node.exe"

rem 1) 优先用 Node.js 22.5+
"%NODE%" -v >nul 2>&1
if errorlevel 1 goto :try_docker

"%NODE%" -e "const p=process.versions.node.split('.').map(Number);process.exit(p[0]>22||(p[0]===22&&p[1]>=5)?0:1)" >nul 2>&1
if errorlevel 1 (
  echo   [!] Node.js 版本低于 22.5，改用 Docker 启动...
  echo.
  goto :try_docker
)

set "NODE_ENV=production"
set "HOST=127.0.0.1"

echo   启动方式 : 本机 Node.js
"%NODE%" -v
echo   网站      : http://localhost:%PORT%
echo   管理后台  : http://localhost:%PORT%/admin/
echo   默认账号  : admin / xunpu2026
echo.
echo   按 Ctrl+C 可停止服务
echo.

call :open_browser
"%NODE%" --disable-warning=ExperimentalWarning server\index.js
goto :stopped

rem 2) 没有 Node，尝试 Docker
:try_docker
where docker >nul 2>&1
if errorlevel 1 goto :no_runtime

docker info >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
    echo   [!] Docker 未运行，正在启动 Docker Desktop...
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    echo       等待 Docker 就绪（最多 2 分钟）...
    for /l %%i in (1,1,60) do (
      timeout /t 2 >nul
      docker info >nul 2>&1 && goto :docker_ready
    )
  )
  echo   [x] Docker 未就绪，请手动打开 Docker Desktop 后重试。
  echo.
  pause
  exit /b 1
)

:docker_ready
set "COMPOSE=docker compose"
docker compose version >nul 2>&1
if errorlevel 1 (
  docker-compose version >nul 2>&1
  if errorlevel 1 (
    echo   [x] Docker 已安装，但缺少 compose 插件。
    echo       请更新 Docker Desktop，或改用 Node.js 启动。
    echo.
    pause
    exit /b 1
  )
  set "COMPOSE=docker-compose"
)

echo   启动方式 : Docker
echo   网站      : http://localhost:%PORT%
echo   管理后台  : http://localhost:%PORT%/admin/
echo   默认账号  : admin / xunpu2026
echo.
echo   首次运行需要构建镜像，可能几分钟；按 Ctrl+C 停止。
echo.

call :open_browser
%COMPOSE% up --build
goto :stopped

rem 3) 两者都没有
:no_runtime
echo   [x] 没找到可用的 Node.js（22.5+）或 Docker
echo.
echo       二选一：
echo       1. 安装 Node.js LTS（22.5 以上）：https://nodejs.org
echo          装完再双击本文件。
echo       2. 安装 Docker Desktop：https://www.docker.com/products/docker-desktop/
echo          装完启动 Docker，再双击本文件。
echo.
pause
exit /b 1

:stopped
echo.
echo   服务已停止。
pause
exit /b 0

rem 轮询健康检查，就绪后再打开浏览器（首次构建 Docker 镜像需要时间）
:open_browser
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){try{$r=Invoke-WebRequest -UseBasicParsing ('http://localhost:'+$env:PORT+'/api/health') -TimeoutSec 2; if($r.StatusCode -eq 200){Start-Process ('http://localhost:'+$env:PORT); break}}catch{}; Start-Sleep -Seconds 2}"
exit /b 0
