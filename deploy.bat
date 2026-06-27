@echo off
chcp 65001 >nul
echo ============================================
echo   外卖平台 - 一键部署
echo   服务器: 23.27.96.135
echo   域名: lingjimgm.xyz
echo ============================================
echo.
echo [1/3] 上传初始化脚本...
scp scripts\server-setup.sh root@23.27.96.135:/root/
if %ERRORLEVEL% NEQ 0 (
    echo SSH 失败！请先运行 setup-ssh.bat 配置免密登录
    pause
    exit /b 1
)

echo [2/3] 执行服务器初始化...
ssh root@23.27.96.135 "bash /root/server-setup.sh"
if %ERRORLEVEL% NEQ 0 (
    echo 服务器初始化失败！
    pause
    exit /b 1
)

echo [3/3] 部署项目...
bash scripts\deploy.sh
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================
    echo   部署完成！
    echo   访问 http://lingjimgm.xyz
    echo   灵境 http://lingjimgm.xyz/lingjing/
    echo ============================================
) else (
    echo 部署失败，请查看上方错误信息
)

pause
