/* 
    提供为其他外部应用API访问，读取和控制播放支持（一架从南航跑出来的380）
*/
const express = require('express');
const { app } = require('electron');

class RemoteApiServer {
    constructor() {
        this.app = express();
        this.app.use(express.json());
        this.server = null;
        this.mainWindow = null; // 将由主进程设置
        this.setupRoutes();
    }

    setMainWindow(win) {
        this.mainWindow = win;
    }

    setupRoutes() {
        // 1. 健康检查/服务器信息
        this.app.get('/api/remote/info', (req, res) => {
            res.json({
                success: true,
                server: 'NB Music Remote API',
                status: this.mainWindow ? 'ready' : 'waiting_for_window',
                endpoints: ['/api/remote/play', '/api/remote/control', '/api/remote/status']
            });
        });

        // 2. 远程播放歌曲 (核心功能)
        this.app.post('/api/remote/play', async (req, res) => {
            if (!this.mainWindow) {
                return res.status(503).json({
                    success: false,
                    error: '主窗口未就绪'
                });
            }

            const { bvid, title, artist, poster } = req.body;
            console.log(`[RemoteApi] 收到播放请求: ${title || bvid}`);

            try {
                // 关键：通过 IPC 调用渲染进程中的函数
                const result = await this.mainWindow.webContents.executeJavaScript(`
                    (async () => {
                        if (window.handleRemotePlayRequest) {
                            return await window.handleRemotePlayRequest(${JSON.stringify(req.body)});
                        } else {
                            return { success: false, error: '渲染进程处理函数未就绪' };
                        }
                    })()
                `);

                res.json(result);
            } catch (error) {
                console.error('[RemoteApi] 调用渲染进程失败:', error);
                res.status(500).json({
                    success: false,
                    error: `内部错误: ${error.message}`
                });
            }
        });

        // 3. 播放控制 (播放/暂停/下一首等)
        this.app.post('/api/remote/control', async (req, res) => {
            if (!this.mainWindow) {
                return res.status(503).json({
                    success: false,
                    error: '主窗口未就绪'
                });
            }

            const { action, value } = req.body;
            console.log(`[RemoteApi] 收到控制请求: ${action}`);

            try {
                const result = await this.mainWindow.webContents.executeJavaScript(`
                    (async () => {
                        if (window.handleRemoteControlRequest) {
                            return await window.handleRemoteControlRequest(${JSON.stringify(req.body)});
                        } else {
                            return { success: false, error: '渲染进程控制函数未就绪' };
                        }
                    })()
                `);

                res.json(result);
            } catch (error) {
                console.error('[RemoteApi] 调用渲染进程失败:', error);
                res.status(500).json({
                    success: false,
                    error: `内部错误: ${error.message}`
                });
            }
        });

        // 4. 获取当前状态
        this.app.get('/api/remote/status', async (req, res) => {
            if (!this.mainWindow) {
                return res.status(503).json({
                    success: false,
                    error: '主窗口未就绪'
                });
            }

            try {
                const status = await this.mainWindow.webContents.executeJavaScript(`
                    (async () => {
                        if (window.getCurrentPlayerStatus) {
                            return await window.getCurrentPlayerStatus();
                        } else {
                            return { success: false, error: '状态获取函数未就绪' };
                        }
                    })()
                `);

                res.json(status);
            } catch (error) {
                console.error('[RemoteApi] 获取状态失败:', error);
                res.status(500).json({
                    success: false,
                    error: `内部错误: ${error.message}`
                });
            }
        });
    }

    start(port = 3001) {
        return new Promise((resolve, reject) => {
            if (this.server) {
                return reject(new Error('服务器已在运行'));
            }

            this.server = this.app.listen(port, '0.0.0.0', () => {
                console.log(`📡 NB Music 远程API服务器已启动`);
                console.log(`   http://localhost:${port}/api/remote/info`);
                console.log(`   WinUI3播放接口: POST http://localhost:${port}/api/remote/play`);
                resolve({ port, url: `http://localhost:${port}` });
            });

            this.server.on('error', reject);
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('远程API服务器已停止');
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = RemoteApiServer;