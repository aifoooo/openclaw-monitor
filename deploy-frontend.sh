#!/bin/bash
# 构建并部署前端

cd ~/ws-mime-qq/openclaw-monitor/packages/client
pnpm build

# ✅ 先清理旧文件，再复制新文件
sudo rm -rf /var/www/openclaw-monitor/*
sudo cp -r dist/* /var/www/openclaw-monitor/
sudo chown -R nginx:nginx /var/www/openclaw-monitor

echo "前端部署完成！"
