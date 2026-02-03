/* 
    修改最小窗口尺寸
    添加用于 380's Artificial Intelligence 的服务器端口
    添加输入模拟服务器支持（无需 robotjs 依赖）
    （一架从南航跑出来的380 修改）
*/

const { app, BrowserWindow, session, ipcMain, Menu, Tray, shell, nativeImage } = require("electron");
const path = require("path");
const puppeteer = require("puppeteer");
const Storage = require("electron-store");
const { autoUpdater } = require("electron-updater");
const storage = new Storage();
const axios = require("axios");
const fs = require("fs");
const https = require("https");

// ========== 新增：导入输入模拟服务器（无依赖版本）==========
const InputSimulationServer = require("./InputSimulationServer_NoDeps");

// 添加自定义Cookies变量
let customBilibiliCookies = null;

let browserAuthServer = null;

// 窗口状态存储键名
const WINDOW_STATE_KEY = "windowState";

console.log('✅ src/main.js 渲染进程主文件已加载');

async function simulateUserSearch(win, searchKeyword) {
    console.log('[模拟搜索] 开始模拟用户搜索:', searchKeyword);

    try {
        // 1. 确保窗口可见并激活
        if (win.isMinimized()) {
            win.restore();
        }
        if (!win.isVisible()) {
            win.show();
        }
        win.focus();

        // 2. 延迟确保页面完全加载
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 3. 查找搜索框并输入关键词
        const searchResult = await win.webContents.executeJavaScript(`
            (function() {
                try {
                    console.log('[模拟搜索] 正在查找搜索框...');
                    
                    // 查找搜索框
                    const searchInput = document.querySelector('.search-music, .input.search-music, .search input[type="text"]');
                    
                    if (!searchInput) {
                        console.error('[模拟搜索] 未找到搜索框元素');
                        // 尝试更多选择器
                        const allInputs = document.querySelectorAll('input[type="text"], input[placeholder*="搜索"], input[placeholder*="search"]');
                        for (let input of allInputs) {
                            if (input.placeholder && (input.placeholder.includes('搜索') || input.placeholder.includes('search'))) {
                                searchInput = input;
                                break;
                            }
                        }
                        
                        if (!searchInput) {
                            return { success: false, error: '未找到搜索框元素' };
                        }
                    }
                    
                    console.log('[模拟搜索] 找到搜索框:', searchInput.className || searchInput.tagName);
                    
                    // 设置搜索关键词
                    searchInput.value = ${JSON.stringify(searchKeyword)};
                    
                    // 触发输入事件
                    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    searchInput.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    // 延迟等待UI响应
                    return new Promise(resolve => {
                        setTimeout(() => {
                            // 尝试查找并点击搜索按钮（如果有）
                            const searchButton = document.querySelector('.search button, [data-action="search"], .bi-search');
                            if (searchButton) {
                                console.log('[模拟搜索] 找到搜索按钮，点击...');
                                searchButton.click();
                            } else {
                                // 如果没有明确按钮，模拟回车键
                                console.log('[模拟搜索] 模拟回车键搜索...');
                                const enterEvent = new KeyboardEvent('keydown', {
                                    key: 'Enter',
                                    code: 'Enter',
                                    keyCode: 13,
                                    charCode: 13,
                                    bubbles: true
                                });
                                searchInput.dispatchEvent(enterEvent);
                                
                                const enterEvent2 = new KeyboardEvent('keypress', {
                                    key: 'Enter',
                                    code: 'Enter',
                                    keyCode: 13,
                                    charCode: 13,
                                    bubbles: true
                                });
                                searchInput.dispatchEvent(enterEvent2);
                            }
                            
                            // 检查是否切换到搜索页面
                            setTimeout(() => {
                                const searchPage = document.querySelector('.search-result, [data-page*="search"], .search-page');
                                const isSearchPageVisible = searchPage && !searchPage.classList.contains('hide');
                                
                                console.log('[模拟搜索] 搜索页面状态:', {
                                    foundElement: !!searchPage,
                                    isVisible: isSearchPageVisible,
                                    currentLocation: window.location.href
                                });
                                
                                resolve({
                                    success: true,
                                    keyword: ${JSON.stringify(searchKeyword)},
                                    searchPageVisible: isSearchPageVisible,
                                    message: '搜索关键词已输入并触发'
                                });
                            }, 1500);
                        }, 500);
                    });
                    
                } catch (error) {
                    console.error('[模拟搜索] 执行过程中出错:', error);
                    return { 
                        success: false, 
                        error: '模拟搜索失败: ' + error.message 
                    };
                }
            })()
        `);

        console.log('[模拟搜索] 模拟结果:', searchResult);
        return searchResult;

    } catch (error) {
        console.error('[模拟搜索] 整体过程出错:', error);
        return {
            success: false,
            error: '模拟搜索过程异常: ' + error.message
        };
    }
}

// 保存窗口状态的函数
function saveWindowState(win) {
    if (!win.isMaximized() && !win.isMinimized()) {
        const bounds = win.getBounds();
        const state = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            isMaximized: false
        };
        storage.set(WINDOW_STATE_KEY, state);
    } else if (win.isMaximized()) {
        storage.set(WINDOW_STATE_KEY, { isMaximized: true });
    }
}

// 获取保存的窗口状态
function getWindowState() {
    const defaultState = {
        width: 1280,
        height: 800,
        isMaximized: false
    };

    try {
        const state = storage.get(WINDOW_STATE_KEY, defaultState);
        return state;
    } catch (error) {
        console.error("获取窗口状态失败:", error);
        return defaultState;
    }
}

// 应用窗口状态
function applyWindowState(win) {
    const state = getWindowState();
    const restoreWindowState = storage.get("restoreWindowState", true);

    if (restoreWindowState) {
        if (state.x !== undefined && state.y !== undefined) {
            const { screen } = require("electron");
            const displays = screen.getAllDisplays();
            let isVisible = false;

            for (const display of displays) {
                const bounds = display.bounds;
                if (state.x >= bounds.x && state.y >= bounds.y && state.x < bounds.x + bounds.width && state.y < bounds.y + bounds.height) {
                    isVisible = true;
                    break;
                }
            }

            if (isVisible) {
                win.setBounds({
                    x: state.x,
                    y: state.y,
                    width: state.width || 1280,
                    height: state.height || 800
                });
            }
        }

        if (state.isMaximized) {
            win.maximize();
        }
    }
}

axios.defaults.withCredentials = true;

function parseCommandLineArgs() {
    const args = process.argv.slice(1);
    const showWelcomeArg = args.includes("--show-welcome");
    const noCookiesArg = args.includes("--no-cookies");
    return {
        showWelcome: showWelcomeArg,
        noCookies: noCookiesArg
    };
}

function setupAutoUpdater(win) {
    // 自动更新已停用
} 

function loadCookies() {
    if (!storage.has("cookies")) return null;
    return storage.get("cookies");
}

function saveCookies(cookieString) {
    storage.set("cookies", cookieString);
}

async function getBilibiliCookies(skipLocalCookies = false) {
    if (customBilibiliCookies) {
        return customBilibiliCookies;
    }
    if (!skipLocalCookies) {
        const cachedCookies = loadCookies();
        if (cachedCookies) {
            return cachedCookies;
        }
    }
    try {
        const browser = await puppeteer.launch({
            headless: true,
            defaultViewport: null
        });
        const page = await browser.newPage();
        await page.goto("https://www.bilibili.com");
        const context = browser.defaultBrowserContext();
        const cookies = await context.cookies("https://www.bilibili.com");
        const cookieString = formatCookieString(cookies);
        saveCookies(cookieString);
        await browser.close();
        return cookieString;
    } catch (error) {
        console.error("获取B站cookies失败:", error);
        return "";
    }
}

function getIconPath() {
    switch (process.platform) {
        case "win32":
            return path.join(__dirname, "../icons/icon.ico");
        default:
            return path.join(__dirname, "../icons/icon.png");
    }
}

function createTrayMenu(win) {
    const iconPath = getIconPath();
    const tray = new Tray(iconPath);

    if (process.platform === "darwin") {
        const trayIcon = nativeImage.createFromPath(iconPath);
        const resizedTrayIcon = trayIcon.resize({
            width: 16,
            height: 16
        });
        tray.setImage(resizedTrayIcon);
    }

    let isPlaying = false;
    let currentSong = { title: "未在播放", artist: "" };

    function updateTrayMenu() {
        let songInfo = currentSong.artist ? `${currentSong.title} - ${currentSong.artist}` : currentSong.title;

        if (songInfo.length > 23) {
            songInfo = songInfo.slice(0, 23) + "...";
        }

        const menuTemplate = [
            {
                label: "🎵 NB Music",
                enabled: false
            },
            { type: "separator" },
            {
                label: songInfo,
                enabled: false
            },
            { type: "separator" },
            {
                label: isPlaying ? "暂停" : "播放",
                click: () => {
                    win.webContents.send("tray-control", "play-pause");
                }
            },
            {
                label: "上一曲",
                click: () => {
                    win.webContents.send("tray-control", "prev");
                }
            },
            {
                label: "下一曲",
                click: () => {
                    win.webContents.send("tray-control", "next");
                }
            },
            { type: "separator" },
            {
                label: "显示主窗口",
                click: () => {
                    showWindow(win);
                }
            },
            {
                label: "设置",
                click: () => {
                    showWindow(win);
                    win.webContents.send("tray-control", "show-settings");
                }
            },
            { type: "separator" },
            {
                label: "检查更新",
                click: () => {
                    win.webContents.send("tray-control", "check-update");
                }
            },
            {
                label: "关于",
                click: () => {
                    win.webContents.send("tray-control", "about");
                }
            },
            { type: "separator" },
            {
                label: "退出",
                click: () => {
                    app.isQuitting = true;
                    app.quit();
                }
            }
        ];

        const contextMenu = Menu.buildFromTemplate(menuTemplate);
        tray.setContextMenu(contextMenu);

        tray.setToolTip(`NB Music - ${isPlaying ? "正在播放: " : "已暂停: "}${songInfo}`);
    }

    tray.on("click", () => {
        showWindow(win);
    });

    ipcMain.on("update-tray", (_, data) => {
        if (data.isPlaying !== undefined) isPlaying = data.isPlaying;
        if (data.song) currentSong = data.song;
        updateTrayMenu();
    });

    updateTrayMenu();

    return tray;
}

function showWindow(win) {
    if (!win.isVisible()) {
        win.show();
    }
    if (win.isMinimized()) {
        win.restore();
    }
    win.focus();
}

let desktopLyricsWindow = null;

function createDesktopLyricsWindow() {
    if (desktopLyricsWindow) {
        desktopLyricsWindow.show();
        return desktopLyricsWindow;
    }

    desktopLyricsWindow = new BrowserWindow({
        width: 800,
        height: 100,
        x: 200,
        y: 100,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            backgroundThrottling: false
        }
    });

    desktopLyricsWindow.loadFile("src/desktop-lyrics.html");

    desktopLyricsWindow.once("ready-to-show", () => {
        desktopLyricsWindow.show();
    });

    desktopLyricsWindow.on("closed", () => {
        desktopLyricsWindow = null;
        if (global.mainWindow) {
            global.mainWindow.webContents.send("desktop-lyrics-closed");
        }
    });

    return desktopLyricsWindow;
}

function createWindow() {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return;
    }

    const windowState = getWindowState();

    const win = new BrowserWindow({
        frame: false,
        icon: getIconPath(),
        backgroundColor: "#2f3241",
        width: windowState.width || 1280,
        height: windowState.height || 800,
        minWidth: 700,
        minHeight: 300,
        x: windowState.x,
        y: windowState.y,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false,
            backgroundThrottling: false
        },
        show: false,
        skipTaskbar: false
    });

    createTrayMenu(win);

    win.once("ready-to-show", () => {
        win.hide(); // 最小化启动
        // win.show();
        // win.focus();

        const restoreWindowState = storage.get("restoreWindowState", true);
        if (restoreWindowState && windowState.isMaximized) {
            win.maximize();
        }
    });

    win.webContents.setBackgroundThrottling(false);

    setupAutoUpdater(win);
    win.loadFile("src/main.html");

    win.webContents.on('did-finish-load', () => {
        console.log('页面加载完成，等待30秒确保所有组件完全初始化...');

        setTimeout(async () => {
            console.log('延迟结束，开始检查并注入远程函数...');

            try {
                const injected = await injectRemoteFunction(win);

                if (injected) {
                    console.log('🎉 远程播放功能初始化完成！');
                    console.log('🎵 现在可以通过 http://localhost:3001/api/remote/play 发送播放请求');
                } else {
                    console.error('⚠️ 远程函数注入失败，将在10秒后重试...');

                    setTimeout(async () => {
                        console.log('开始重试注入远程函数...');
                        await injectRemoteFunction(win);
                    }, 10000);
                }
            } catch (error) {
                console.error('初始化远程功能时出错:', error);
            }
        }, 30000);
    });

    if (!app.isPackaged) {
        win.webContents.openDevTools();
    }
    const cmdArgs = parseCommandLineArgs();
    win.webContents.on("did-finish-load", () => {
        win.webContents.send("command-line-args", cmdArgs);
    });

    app.on("second-instance", (event, commandLine) => {
        if (win) {
            if (!win.isVisible()) win.show();
            if (win.isMinimized()) win.restore();
            win.focus();

            const secondInstanceArgs = parseCommandLineArgs(commandLine);
            if (secondInstanceArgs.showWelcome) {
                win.webContents.send("show-welcome");
            }
        }
    });

    app.isQuitting = false;

    win.on("resize", () => {
        if (!win.isMinimized()) {
            saveWindowState(win);
        }
    });

    win.on("move", () => {
        if (!win.isMinimized()) {
            saveWindowState(win);
        }
    });

    win.on("close", (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            saveWindowState(win);
            win.hide();
            return false;
        }
    });

    ipcMain.on("window-minimize", () => {
        win.minimize();
    });

    ipcMain.on("window-maximize", (_, order) => {
        if (order === "maximize") {
            win.maximize();
        } else if (order === "unmaximize") {
            win.unmaximize();
        } else {
            if (win.isMaximized()) {
                win.unmaximize();
            } else {
                win.maximize();
            }
        }
    });

    ipcMain.on("window-close", () => {
        win.hide();
    });

    ipcMain.on("quit-app", () => {
        app.isQuitting = true;
        app.quit();
    });

    win.on("maximize", () => {
        win.webContents.send("window-state-changed", true);
    });

    win.on("unmaximize", () => {
        win.webContents.send("window-state-changed", false);
    });

    win.on("show", () => {
        win.webContents.send("window-show");
    });

    win.on("hide", () => {
        win.webContents.send("window-hide");
    });

    win.on("minimize", () => {
        win.webContents.send("window-minimized");
    });

    win.on("restore", () => {
        win.webContents.send("window-restored");
    });

    ipcMain.on("login-success", async (event, data) => {
        try {
            const { cookies } = data;
            if (!cookies || cookies.length === 0) {
                throw new Error("未能获取到cookie");
            }

            saveCookies(cookies.join(";") + ';nbmusic_loginmode=qrcode');
            setBilibiliRequestCookie(cookies.join(";") + ';nbmusic_loginmode=qrcode');
            win.webContents.send("cookies-set", true);
        } catch (error) {
            console.error("登录失败:", error);
            win.webContents.send("cookies-set-error", error.message);
        }
    });

    ipcMain.on("open-dev-tools", () => {
        if (win.webContents.isDevToolsOpened()) {
            win.webContents.closeDevTools();
        } else {
            win.webContents.openDevTools();
        }
    });

    ipcMain.on("open-dev-tools-request", (_, { devToolsEnabled }) => {
        if (devToolsEnabled || !app.isPackaged) {
            if (win.webContents.isDevToolsOpened()) {
                win.webContents.closeDevTools();
            } else {
                win.webContents.openDevTools();
            }
        }
    });

    ipcMain.on("get-cookies", async () => {
        win.webContents.send("get-cookies-success", loadCookies());
    });

    ipcMain.on("logout", async () => {
        storage.delete("cookies");
        win.webContents.send("logout-success");
        setBilibiliRequestCookie("");
    });

    ipcMain.handle("get-download-path", async () => {
        return app.getPath("downloads");
    });

    ipcMain.on("start-browser-auth-server", async () => {
        if (browserAuthServer === null) {
            browserAuthServer = https
                .createServer(
                    {
                        key: fs.readFileSync(path.join(__dirname, "..", "ssl", "privkey.pem")),
                        cert: fs.readFileSync(path.join(__dirname, "..", "ssl", "fullchain.pem"))
                    },
                    function (request, response) {
                        if (request.url === "/callback") {
                            let cookieString = request.headers.cookie + ";nbmusic_loginmode=browser";
                            saveCookies(cookieString);
                            setBilibiliRequestCookie(cookieString);
                            response.writeHead(200, { "Content-Type": "application/json" });
                            response.end(
                                JSON.stringify({
                                    status: 0,
                                    data: {
                                        isLogin: true,
                                        message: "登录成功"
                                    }
                                })
                            );
                            win.webContents.send("cookies-set", true);
                            browserAuthServer.close();
                            browserAuthServer = null;
                        } else if (request.url === "/background.png") {
                            response.writeHead(200, { "Content-Type": "image/png" });
                            response.end(fs.readFileSync(path.join(__dirname, "..", "img", "NB_Music.png")));
                        } else if (request.url === "/getUserInfo") {
                            axios
                                .get("https://api.bilibili.com/x/web-interface/nav", {
                                    headers: {
                                        Cookie: request.headers.cookie,
                                        Referer: "https://www.bilibili.com/",
                                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
                                    }
                                })
                                .then((res) => {
                                    const data = res.data.data;
                                    response.writeHead(200, { "Content-Type": "application/json" });
                                    if (data.isLogin) {
                                        response.end(
                                            JSON.stringify({
                                                status: 0,
                                                data: {
                                                    isLogin: true,
                                                    avatar: data.face,
                                                    name: data.uname,
                                                    mid: data.mid
                                                }
                                            })
                                        );
                                    } else {
                                        response.end(
                                            JSON.stringify({
                                                status: 0,
                                                data: {
                                                    isLogin: false
                                                }
                                            })
                                        );
                                    }
                                })
                                .catch((error) => {
                                    console.error("获取用户信息失败:", error);
                                    response.writeHead(500, { "Content-Type": "application/json" });
                                    response.end(
                                        JSON.stringify({
                                            status: -1,
                                            data: {
                                                message: "服务内部错误"
                                            }
                                        })
                                    );
                                });
                        } else if (request.url === "/favicon.ico") {
                            response.writeHead(200, { "Content-Type": "image/x-icon" });
                            response.end(fs.readFileSync(path.join(__dirname, "..", "icons", "icon.ico")));
                        } else {
                            response.writeHead(200, { "Content-Type": "text/html" });
                            response.end(fs.readFileSync(path.join(__dirname, "login.html")));
                        }
                    }
                )
                .listen(62687);
        }
    });

    ipcMain.on("close-browser-auth-server", async () => {
        if (browserAuthServer !== null) {
            browserAuthServer.close();
            browserAuthServer = null;
        }
    });

    ipcMain.on("set-restore-window-state", (event, value) => {
        storage.set("restoreWindowState", value);
    });

    return win;
}

function formatCookieString(cookies) {
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join(";");
}

app.whenReady().then(async () => {
    if (!app.isPackaged && process.argv[2] != "--no-reload") {
        require("electron-reload")(__dirname, {
            electron: path.join(process.cwd(), "node_modules", ".bin", "electron")
        });
    }

    global.mainWindow = createWindow();

    // ========== 初始化远程控制API服务器 ==========
    const express = require('express');
    const remoteApiApp = express();
    remoteApiApp.use(express.json());
    let remoteApiServer = null;

    // 1. 搜索歌曲接口
    remoteApiApp.get('/api/remote/search', async (req, res) => {
        console.log('[RemoteAPI] 收到搜索请求:', req.query.keyword);

        if (!global.mainWindow) {
            return res.status(503).json({ success: false, error: '主窗口未就绪' });
        }

        const { keyword, page = 1, limit = 20 } = req.query;
        if (!keyword) {
            return res.status(400).json({ success: false, error: '缺少搜索关键词' });
        }

        try {
            const result = await global.mainWindow.webContents.executeJavaScript(`
            (async () => {
                if (window.__handleRemoteSearch) {
                    const request = {
                        keyword: ${JSON.stringify(keyword)},
                        page: ${parseInt(page)},
                        limit: ${parseInt(limit)}
                    };
                    return await window.__handleRemoteSearch(request);
                } else {
                    return { success: false, error: '搜索功能未就绪' };
                }
            })()
        `);

            res.json(result);
        } catch (error) {
            console.error('[RemoteAPI] 搜索调用失败:', error);
            res.status(500).json({
                success: false,
                error: '搜索服务暂时不可用: ' + error.message
            });
        }
    });

    // 2. 热门歌曲接口
    remoteApiApp.get('/api/remote/hot-songs', async (req, res) => {
        console.log('[RemoteAPI] 收到热门歌曲请求');
        const { limit = 20 } = req.query;

        try {
            const apiResponse = await axios.get(`https://api.bilibili.com/x/web-interface/popular`);
            const videoList = apiResponse.data?.data?.list || [];

            const musicVideos = videoList.filter(video => {
                const musicTids = [3, 28, 29, 31, 30, 267, 59, 193, 243, 266, 265, 244, 130];
                if (musicTids.includes(video.tid)) {
                    return true;
                }

                const title = video.title.toLowerCase();
                const musicKeywords = [
                    '音乐', '歌曲', '歌', 'music', 'mv', 'cover', '翻唱', '现场', 'live', '现场版',
                    'pop', 'rock', 'jazz', '古典', '民谣', '说唱', 'rap', 'hiphop', '电子', '电音',
                    '演奏', '弹唱', '演唱', '钢琴', '吉他', '鼓', '乐队', '合唱', '交响'
                ];
                const hasMusicKeyword = musicKeywords.some(keyword => title.includes(keyword));
                const isReasonableDuration = video.duration >= 60 && video.duration <= 600;

                if (hasMusicKeyword) {
                    if (isReasonableDuration) return true;
                    if (title.includes('mv') || title.includes('音乐') || title.includes('歌曲')) {
                        return true;
                    }
                }

                return false;
            });

            if (musicVideos.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        songs: [],
                        count: 0,
                        total: videoList.length,
                        source: 'bilibili_popular_filtered',
                        note: '已过滤热门视频，但未识别出明确的音乐内容。'
                    }
                });
            }

            const songs = musicVideos.slice(0, parseInt(limit)).map(video => ({
                bvid: video.bvid,
                title: video.title,
                artist: video.owner?.name || '未知UP主',
                poster: video.pic && !video.pic.startsWith('http') ? `http:${video.pic}` : video.pic,
                duration: video.duration,
                playCount: video.stat?.view || 0,
                description: `分区: ${video.tname || '未知'} | 播放: ${video.stat?.view || 0} | 点赞: ${video.stat?.like || 0}`,
                tid: video.tid,
                tname: video.tname,
                upMid: video.owner?.mid
            }));

            res.json({
                success: true,
                data: {
                    songs: songs,
                    count: songs.length,
                    total: musicVideos.length,
                    source: 'bilibili_popular_filtered',
                    note: `从${videoList.length}个热门视频中筛选出${musicVideos.length}个音乐相关视频。`
                }
            });

        } catch (error) {
            console.error('[RemoteAPI] ERROR', error);
            res.status(500).json({
                success: false,
                error: `处理请求时发生意外错误: ${error.message}`
            });
        }
    });

    // 3. 远程播放接口
    remoteApiApp.post('/api/remote/play', async (req, res) => {
        console.log('[RemoteAPI] 收到远程播放请求:', JSON.stringify(req.body));
        
        if (!global.mainWindow) {
            console.error('[RemoteAPI] 主窗口未就绪');
            return res.status(503).json({ 
                success: false, 
                error: 'NB Music 主窗口未就绪'
            });
        }
        
        const { bvid, title, artist, poster } = req.body;
        const searchKeyword = title;
        
        if (!searchKeyword) {
            return res.status(400).json({
                success: false,
                error: '缺少搜索关键词'
            });
        }
        
        try {
            console.log('[RemoteAPI] 开始模拟搜索:', searchKeyword);
            const searchResult = await simulateUserSearch(global.mainWindow, searchKeyword);

            if (!searchResult.success) {
                console.warn('[RemoteAPI] 模拟搜索失败:', searchResult.error);
            }

            await new Promise(resolve => setTimeout(resolve, 3000));

            const finalResult = {
                search: searchResult,
                timestamp: new Date().toISOString(),
                keyword: searchKeyword
            };

            res.json(finalResult);

        } catch (error) {
            console.error('[RemoteAPI] 搜索过程出错:', error);
            res.status(500).json({
                success: false,
                error: '搜索过程异常: ' + error.message,
                keyword: searchKeyword
            });
        }
    });

    // 测试接口
    remoteApiApp.get('/api/remote/test-connection', async (req, res) => {
        if (!global.mainWindow) {
            return res.json({
                success: false,
                error: '主窗口未就绪',
                windowExists: false
            });
        }

        try {
            const testResult = await global.mainWindow.webContents.executeJavaScript(`
            (function() {
                return {
                    success: true,
                    data: {
                        appName: 'NB Music for 380's Artificial Intelligence',
                        pageTitle: document.title,
                        timestamp: new Date().toISOString()
                    }
                };
            })()
        `);

            res.json(testResult);
        } catch (error) {
            res.json({
                success: false,
                error: '通信测试失败: ' + error.message
            });
        }
    });

    // 4.窗口控制端口
    remoteApiApp.post('/api/window/control', async (req, res) => {
        console.log('[RemoteAPI] 收到窗口控制请求:', req.body);

        if (!global.mainWindow) {
            return res.status(503).json({
                success: false,
                error: 'NB Music 主窗口未就绪'
            });
        }

        const { command } = req.body;
        if (!command) {
            return res.status(400).json({
                success: false,
                error: '缺少命令参数'
            });
        }

        try {
            const result = await global.mainWindow.webContents.executeJavaScript(`
            (async () => {
                try {
                    const { ipcRenderer } = require('electron');
                    return await ipcRenderer.invoke('window-control', ${JSON.stringify(command)});
                } catch (error) {
                    return { success: false, error: error.message };
                }
            })()
        `);

            res.json(result);
        } catch (error) {
            console.error('[RemoteAPI] 窗口控制失败:', error);
            res.status(500).json({
                success: false,
                error: '窗口控制失败: ' + error.message
            });
        }
    });

    // 添加窗口状态查询端点
    remoteApiApp.get('/api/window/state', async (req, res) => {
        if (!global.mainWindow) {
            return res.json({
                success: false,
                error: '主窗口未就绪',
                exists: false
            });
        }

        try {
            const state = await global.mainWindow.webContents.executeJavaScript(`
            (function() {
                const win = require('electron').remote.getCurrentWindow();
                return {
                    isVisible: win.isVisible(),
                    isMaximized: win.isMaximized(),
                    isMinimized: win.isMinimized(),
                    isFocused: win.isFocused()
                };
            })()
        `);

            res.json({
                success: true,
                data: state
            });
        } catch (error) {
            // 备用方式：使用主进程查询
            const win = global.mainWindow;
            res.json({
                success: true,
                data: {
                    isVisible: win.isVisible(),
                    isMaximized: win.isMaximized(),
                    isMinimized: win.isMinimized(),
                    isFocused: win.isFocused()
                }
            });
        }
    });

    // 启动远程API服务器
    function startRemoteServer(startPort = 3001, maxTries = 5) {
        for (let i = 0; i < maxTries; i++) {
            const port = startPort + i;
            try {
                remoteApiServer = remoteApiApp.listen(port, '0.0.0.0', () => {
                    console.log(`📡 远程控制API服务器已启动: http://localhost:${port}`);
                });
                return port;
            } catch (err) {
                if (err.code === 'EADDRINUSE') {
                    console.log(`端口 ${port} 被占用，尝试 ${port + 1}...`);
                    continue;
                }
                throw err;
            }
        }
        throw new Error(`无法启动服务器`);
    }

    try {
        const port = startRemoteServer(3001, 3);
        console.log(`✅ 远程API服务运行在端口 ${port}`);
    } catch (err) {
        console.error('❌ 启动远程API服务器失败:', err.message);
    }

    // ========== 新增：初始化输入模拟服务器（无依赖版本）==========
    const inputSimServer = new InputSimulationServer();
    inputSimServer.setMainWindow(global.mainWindow);
    
    try {
        const inputServerInfo = await inputSimServer.start(3002);
        console.log(`✅ 输入模拟服务器运行在端口 ${inputServerInfo.port}`);
        console.log(`   使用 Electron 原生 API，无需 robotjs 依赖`);
        console.log(`   HTTP API: ${inputServerInfo.url}/api/input/status`);
        console.log(`   WebSocket: ws://localhost:${inputServerInfo.port}`);
    } catch (err) {
        console.error('❌ 启动输入模拟服务器失败:', err.message);
    }
    // ========== 服务器初始化结束 ==========

    setupIPC();
    const cmdArgs = parseCommandLineArgs();

    const cookieString = await getBilibiliCookies(cmdArgs.noCookies);
    if (cookieString) {
        setBilibiliRequestCookie(cookieString);
    }
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("before-quit", () => {
    app.isQuitting = true;
});

app.on("activate", () => {
    if (global.mainWindow) {
        if (!global.mainWindow.isVisible()) {
            global.mainWindow.show();
        }
        if (global.mainWindow.isMinimized()) {
            global.mainWindow.restore();
        }
        global.mainWindow.focus();
    }
});

function setupIPC() {
    ipcMain.handle("get-app-version", () => {
        return app.getVersion();
    });

    ipcMain.on("check-for-updates", () => {
        if (!app.isPackaged) {
            BrowserWindow.getFocusedWindow()?.webContents.send("update-not-available", {
                message: "开发环境中无法检查更新"
            });
            return;
        }

        autoUpdater.checkForUpdates().catch((err) => {
            console.error("更新检查失败:", err);
            BrowserWindow.getFocusedWindow()?.webContents.send("update-error", err.message);
        });
    });

    ipcMain.on("install-update", () => {
        autoUpdater.quitAndInstall(true, true);
    });

    ipcMain.on("open-external-link", (_, url) => {
        shell.openExternal(url);
    });

    ipcMain.on("quit-application", () => {
        app.isQuitting = true;
        app.quit();
    });

    ipcMain.on("toggle-desktop-lyrics", (event, enabled) => {
        if (enabled) {
            createDesktopLyricsWindow();
        } else if (desktopLyricsWindow) {
            desktopLyricsWindow.close();
            desktopLyricsWindow = null;
        }
    });

    ipcMain.on("update-desktop-lyrics", (event, lyricsData) => {
        if (desktopLyricsWindow) {
            desktopLyricsWindow.webContents.send("update-desktop-lyrics", lyricsData);
        }
    });

    ipcMain.on("update-lyrics-style", (event, style) => {
        if (desktopLyricsWindow) {
            desktopLyricsWindow.webContents.send("update-lyrics-style", style);
        }
    });

    ipcMain.on("desktop-lyrics-toggle-play", () => {
        if (global.mainWindow) {
            global.mainWindow.webContents.send("desktop-lyrics-control", "toggle-play");
        }
    });

    ipcMain.on("desktop-lyrics-seek", (event, time) => {
        if (global.mainWindow) {
            global.mainWindow.webContents.send("desktop-lyrics-control", "seek", time);
        }
    });

    ipcMain.on("desktop-lyrics-update-style", (event, style) => {
        if (global.mainWindow) {
            global.mainWindow.webContents.send("desktop-lyrics-style-changed", style);
        }
    });

    ipcMain.on("desktop-lyrics-resize", (event, size) => {
        if (desktopLyricsWindow) {
            desktopLyricsWindow.setSize(size.width, size.height);
        }
    });

    ipcMain.on("desktop-lyrics-bg-color", () => {
        if (global.mainWindow) {
            global.mainWindow.webContents.send("show-lyrics-bg-color-picker");
        }
    });

    ipcMain.on("desktop-lyrics-ready", () => {
        if (global.mainWindow) {
            global.mainWindow.webContents.send("desktop-lyrics-ready");
        }
    });

    ipcMain.on("desktop-lyrics-toggle-pin", () => {
        if (desktopLyricsWindow) {
            const isAlwaysOnTop = desktopLyricsWindow.isAlwaysOnTop();
            desktopLyricsWindow.setAlwaysOnTop(!isAlwaysOnTop);
            if (global.mainWindow) {
                global.mainWindow.webContents.send("desktop-lyrics-pin-changed", !isAlwaysOnTop);
            }
        }
    });

    ipcMain.on("desktop-lyrics-font-size", () => {
        if (global.mainWindow) {
            global.mainWindow.webContents.send("open-lyrics-font-settings");
        }
    });

    ipcMain.on("desktop-lyrics-settings", () => {
        if (global.mainWindow) {
            global.mainWindow.webContents.send("open-lyrics-settings");
            global.mainWindow.focus();
        }
    });

    ipcMain.on("desktop-lyrics-close", () => {
        if (desktopLyricsWindow) {
            desktopLyricsWindow.close();
            desktopLyricsWindow = null;
        }
    });

    ipcMain.on("force-sync-desktop-lyrics", () => {
        if (global.mainWindow && desktopLyricsWindow) {
            global.mainWindow.webContents.send("request-lyrics-sync");
        }
    });

    ipcMain.handle("get-restore-window-state", () => {
        return storage.get("restoreWindowState", true);
    });

    ipcMain.on("set-custom-cookies", (event, cookies) => {
        customBilibiliCookies = cookies;
        setBilibiliRequestCookie(cookies);
    });
    
    ipcMain.on("use-default-cookies", async () => {
        customBilibiliCookies = null;
        const cookieString = await getBilibiliCookies();
        if (cookieString) {
            setBilibiliRequestCookie(cookieString);
        }
    });

    // 新增：窗口控制命令接口
    ipcMain.handle('window-control', async (event, command) => {
        if (!global.mainWindow) {
            return { success: false, error: '窗口不存在' };
        }

        const win = global.mainWindow;

        switch (command) {
            case 'minimize':
                win.minimize();
                return { success: true };

            case 'maximize':
                if (win.isMaximized()) {
                    win.unmaximize();
                } else {
                    win.maximize();
                }
                return { success: true };

            case 'show':
                win.show();
                if (win.isMinimized()) {
                    win.restore();
                }
                win.focus();
                return { success: true };

            case 'hide':
                win.hide();
                return { success: true };

            case 'toggle-visibility':
                if (win.isVisible()) {
                    win.hide();
                } else {
                    win.show();
                    if (win.isMinimized()) {
                        win.restore();
                    }
                    win.focus();
                }
                return { success: true };

            case 'get-state':
                return {
                    success: true,
                    data: {
                        isVisible: win.isVisible(),
                        isMaximized: win.isMaximized(),
                        isMinimized: win.isMinimized()
                    }
                };

            case 'restart':
                // 重启应用
                app.relaunch();
                app.exit(0);
                return { success: true };

            case 'quit':
                app.isQuitting = true;
                app.quit();
                return { success: true };

            default:
                return { success: false, error: '未知命令' };
        }
    });

    // 新增：监控窗口状态变化
    if (global.mainWindow) {
        const win = global.mainWindow;

        ['show', 'hide', 'maximize', 'unmaximize', 'minimize', 'restore'].forEach(eventName => {
            win.on(eventName, () => {
                // 可以通过 HTTP 通知 WinUI3，或者 WinUI3 轮询查询状态
            });
        });
    }
}

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

function setBilibiliRequestCookie(cookieString) {
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        if (details.url.includes("bilibili.com") || details.url.includes("bilivideo.cn") || details.url.includes("bilivideo.com") || details.url.includes("akamaized.net")) {
            details.requestHeaders["Cookie"] = cookieString;
            details.requestHeaders["Referer"] = "https://www.bilibili.com/";
            details.requestHeaders["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
        }
        callback({ requestHeaders: details.requestHeaders });
    });
}