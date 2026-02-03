/**
 * 输入模拟服务器 - 无需 robotjs 依赖版本
 * 使用 Electron 原生 API (webContents.sendInputEvent)
 * 作者: 一架从南航跑出来的380
 */

const express = require('express');
const WebSocket = require('ws');

class InputSimulationServer {
    constructor() {
        this.app = express();
        this.app.use(express.json());
        this.httpServer = null;
        this.wss = null;
        this.mainWindow = null;
        this.clients = new Set();

        // 窗口信息缓存
        this.windowBounds = { x: 0, y: 0, width: 1280, height: 800 };

        this.setupRoutes();
    }

    setMainWindow(win) {
        this.mainWindow = win;
        this.updateWindowBounds();

        // 监听窗口移动和调整大小
        if (this.mainWindow) {
            this.mainWindow.on('move', () => this.updateWindowBounds());
            this.mainWindow.on('resize', () => this.updateWindowBounds());
        }
    }

    updateWindowBounds() {
        if (this.mainWindow) {
            this.windowBounds = this.mainWindow.getBounds();
            console.log('[InputSim] 窗口边界更新:', this.windowBounds);
        }
    }

    setupRoutes() {
        // 健康检查
        this.app.get('/api/input/status', (req, res) => {
            res.json({
                success: true,
                server: 'NB Music Input Simulation Server (No Dependencies)',
                status: this.mainWindow ? 'ready' : 'waiting_for_window',
                connectedClients: this.clients.size,
                windowBounds: this.windowBounds,
                method: 'Electron Native API (webContents.sendInputEvent)'
            });
        });

        // HTTP接口 - 单次鼠标点击
        this.app.post('/api/input/click', async (req, res) => {
            try {
                const { x, y, button = 'left', doubleClick = false } = req.body;

                if (x === undefined || y === undefined) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少坐标参数 x 或 y'
                    });
                }

                const result = await this.simulateClick(x, y, button, doubleClick);
                res.json(result);
            } catch (error) {
                console.error('[InputSim] 点击模拟失败:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // HTTP接口 - 键盘输入
        this.app.post('/api/input/keyboard', async (req, res) => {
            try {
                const { key, text, modifiers = [] } = req.body;

                const result = await this.simulateKeyboard(key, text, modifiers);
                res.json(result);
            } catch (error) {
                console.error('[InputSim] 键盘模拟失败:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // HTTP接口 - 鼠标移动
        this.app.post('/api/input/move', async (req, res) => {
            try {
                const { x, y } = req.body;

                if (x === undefined || y === undefined) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少坐标参数 x 或 y'
                    });
                }

                const result = await this.simulateMouseMove(x, y);
                res.json(result);
            } catch (error) {
                console.error('[InputSim] 鼠标移动模拟失败:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // HTTP接口 - 鼠标滚轮
        this.app.post('/api/input/wheel', async (req, res) => {
            try {
                const { x, y, deltaX = 0, deltaY = 0 } = req.body;

                const result = await this.simulateMouseWheel(x, y, deltaX, deltaY);
                res.json(result);
            } catch (error) {
                console.error('[InputSim] 滚轮模拟失败:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });
    }

    setupWebSocket() {
        this.wss = new WebSocket.Server({ server: this.httpServer });

        this.wss.on('connection', (ws, req) => {
            const clientIp = req.socket.remoteAddress;
            console.log(`[InputSim] WebSocket客户端连接: ${clientIp}`);
            this.clients.add(ws);

            // 发送欢迎消息
            ws.send(JSON.stringify({
                type: 'connected',
                message: 'NB Music输入模拟服务器已连接 (无依赖版本)',
                windowBounds: this.windowBounds
            }));

            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    await this.handleWebSocketMessage(data, ws);
                } catch (error) {
                    console.error('[InputSim] WebSocket消息解析失败:', error);
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: '消息格式错误'
                    }));
                }
            });

            ws.on('close', () => {
                console.log(`[InputSim] WebSocket客户端断开: ${clientIp}`);
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('[InputSim] WebSocket错误:', error);
                this.clients.delete(ws);
            });
        });
    }

    async handleWebSocketMessage(data, ws) {
        const { type, x, y, button, key, text, modifiers, doubleClick, deltaX, deltaY } = data;

        let result;
        switch (type) {
            case 'click':
                result = await this.simulateClick(x, y, button, doubleClick);
                break;
            case 'move':
                result = await this.simulateMouseMove(x, y);
                break;
            case 'wheel':
                result = await this.simulateMouseWheel(x, y, deltaX, deltaY);
                break;
            case 'keyboard':
                result = await this.simulateKeyboard(key, text, modifiers);
                break;
            case 'ping':
                result = { type: 'pong', timestamp: Date.now() };
                break;
            default:
                result = { success: false, error: '未知的消息类型' };
        }

        ws.send(JSON.stringify(result));
    }

    /**
     * 模拟鼠标点击 - 使用 Electron 原生 API
     */
    async simulateClick(relativeX, relativeY, button = 'left', doubleClick = false) {
        if (!this.mainWindow || !this.mainWindow.webContents) {
            return {
                success: false,
                error: '主窗口未就绪'
            };
        }

        try {
            const x = Math.round(relativeX);
            const y = Math.round(relativeY);

            console.log(`[InputSim] 模拟点击: 相对(${x}, ${y}), 按钮: ${button}, 双击: ${doubleClick}`);

            // 1. 先发送鼠标移动事件
            this.mainWindow.webContents.sendInputEvent({
                type: 'mouseMove',
                x: x,
                y: y
            });

            // 短暂延迟
            await this.sleep(10);

            // 2. 发送鼠标按下事件
            this.mainWindow.webContents.sendInputEvent({
                type: 'mouseDown',
                x: x,
                y: y,
                button: button,
                clickCount: doubleClick ? 2 : 1
            });

            // 短暂延迟
            await this.sleep(10);

            // 3. 发送鼠标释放事件
            this.mainWindow.webContents.sendInputEvent({
                type: 'mouseUp',
                x: x,
                y: y,
                button: button,
                clickCount: doubleClick ? 2 : 1
            });

            return {
                success: true,
                action: 'click',
                position: { x, y },
                button,
                doubleClick,
                method: 'Electron webContents.sendInputEvent'
            };
        } catch (error) {
            console.error('[InputSim] 点击模拟错误:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 模拟鼠标移动
     */
    async simulateMouseMove(relativeX, relativeY) {
        if (!this.mainWindow || !this.mainWindow.webContents) {
            return {
                success: false,
                error: '主窗口未就绪'
            };
        }

        try {
            const x = Math.round(relativeX);
            const y = Math.round(relativeY);

            this.mainWindow.webContents.sendInputEvent({
                type: 'mouseMove',
                x: x,
                y: y
            });

            return {
                success: true,
                action: 'move',
                position: { x, y }
            };
        } catch (error) {
            console.error('[InputSim] 鼠标移动错误:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 模拟鼠标滚轮
     */
    async simulateMouseWheel(relativeX, relativeY, deltaX = 0, deltaY = 0) {
        if (!this.mainWindow || !this.mainWindow.webContents) {
            return {
                success: false,
                error: '主窗口未就绪'
            };
        }

        try {
            const x = Math.round(relativeX);
            const y = Math.round(relativeY);

            this.mainWindow.webContents.sendInputEvent({
                type: 'mouseWheel',
                x: x,
                y: y,
                deltaX: deltaX,
                deltaY: deltaY
            });

            return {
                success: true,
                action: 'wheel',
                position: { x, y },
                delta: { deltaX, deltaY }
            };
        } catch (error) {
            console.error('[InputSim] 滚轮模拟错误:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 模拟键盘输入
     */
    async simulateKeyboard(key, text, modifiers = []) {
        if (!this.mainWindow || !this.mainWindow.webContents) {
            return {
                success: false,
                error: '主窗口未就绪'
            };
        }

        try {
            if (text) {
                // 输入文本 - 逐字符发送
                console.log(`[InputSim] 模拟输入文本: ${text}`);

                for (const char of text) {
                    // keyDown
                    this.mainWindow.webContents.sendInputEvent({
                        type: 'keyDown',
                        keyCode: char
                    });

                    await this.sleep(5);

                    // char 事件
                    this.mainWindow.webContents.sendInputEvent({
                        type: 'char',
                        keyCode: char
                    });

                    await this.sleep(5);

                    // keyUp
                    this.mainWindow.webContents.sendInputEvent({
                        type: 'keyUp',
                        keyCode: char
                    });

                    await this.sleep(10);
                }

                return {
                    success: true,
                    action: 'type',
                    text
                };
            } else if (key) {
                // 按下特定按键
                console.log(`[InputSim] 模拟按键: ${key}, 修饰键: ${modifiers.join('+')}`);

                // 转换按键名称为 Electron keyCode
                const keyCode = this.convertKeyToKeyCode(key);

                // 构建修饰键
                const modifiersArray = modifiers.map(m => this.convertModifierKey(m)).filter(Boolean);

                // keyDown
                this.mainWindow.webContents.sendInputEvent({
                    type: 'keyDown',
                    keyCode: keyCode,
                    modifiers: modifiersArray
                });

                await this.sleep(10);

                // keyUp
                this.mainWindow.webContents.sendInputEvent({
                    type: 'keyUp',
                    keyCode: keyCode,
                    modifiers: modifiersArray
                });

                return {
                    success: true,
                    action: 'keypress',
                    key,
                    modifiers
                };
            } else {
                return {
                    success: false,
                    error: '必须提供 key 或 text 参数'
                };
            }
        } catch (error) {
            console.error('[InputSim] 键盘模拟错误:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 将按键名称转换为 Electron keyCode
     */
    convertKeyToKeyCode(key) {
        const keyMap = {
            'enter': '\u000D',
            'backspace': '\u0008',
            'tab': '\u0009',
            'escape': '\u001B',
            'space': ' ',
            'delete': '\u007F',
            'up': '\uF700',
            'down': '\uF701',
            'left': '\uF702',
            'right': '\uF703',
            'home': '\uF729',
            'end': '\uF72B',
            'pageup': '\uF72C',
            'pagedown': '\uF72D',
            'f1': '\uF704',
            'f2': '\uF705',
            'f3': '\uF706',
            'f4': '\uF707',
            'f5': '\uF708',
            'f6': '\uF709',
            'f7': '\uF70A',
            'f8': '\uF70B',
            'f9': '\uF70C',
            'f10': '\uF70D',
            'f11': '\uF70E',
            'f12': '\uF70F'
        };

        return keyMap[key.toLowerCase()] || key;
    }

    /**
     * 转换修饰键名称
     */
    convertModifierKey(modifier) {
        const modifierMap = {
            'control': 'control',
            'ctrl': 'control',
            'shift': 'shift',
            'alt': 'alt',
            'meta': 'meta',
            'command': 'meta'
        };

        return modifierMap[modifier.toLowerCase()];
    }

    /**
     * 延迟函数
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 启动服务器
     */
    start(port = 3002) {
        return new Promise((resolve, reject) => {
            if (this.httpServer) {
                return reject(new Error('服务器已在运行'));
            }

            this.httpServer = this.app.listen(port, '0.0.0.0', () => {
                console.log(`📡 NB Music 输入模拟服务器已启动 (无依赖版本)`);
                console.log(`   HTTP: http://localhost:${port}/api/input/status`);
                console.log(`   WebSocket: ws://localhost:${port}`);
                console.log(`   使用 Electron 原生 API，无需 robotjs`);

                // 启动WebSocket服务器
                this.setupWebSocket();

                resolve({ port, url: `http://localhost:${port}` });
            });

            this.httpServer.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    console.log(`端口 ${port} 被占用，尝试 ${port + 1}...`);
                    this.start(port + 1).then(resolve).catch(reject);
                } else {
                    reject(error);
                }
            });
        });
    }

    /**
     * 停止服务器
     */
    stop() {
        return new Promise((resolve) => {
            // 关闭所有WebSocket连接
            this.clients.forEach(client => {
                client.close();
            });
            this.clients.clear();

            // 关闭WebSocket服务器
            if (this.wss) {
                this.wss.close();
                this.wss = null;
            }

            // 关闭HTTP服务器
            if (this.httpServer) {
                this.httpServer.close(() => {
                    console.log('输入模拟服务器已停止');
                    this.httpServer = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = InputSimulationServer;