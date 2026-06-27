@echo off
title SSH 免密配置 - 外卖平台
echo ============================================
echo   外卖平台 - SSH 免密配置
echo ============================================
echo.
echo 连接服务器: root@23.27.96.135
echo.
echo 当出现 "password:" 时，输入你的服务器密码
echo.

type %USERPROFILE%\.ssh\id_ed25519.pub | ssh root@23.27.96.135 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo SUCCESS"

if %ERRORLEVEL% EQU 0 (
    echo SSH 免密配置完成！
) else (
    echo 失败，请重试。
)
pause
