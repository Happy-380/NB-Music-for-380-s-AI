const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const EventEmitter = require('events');

class RemoteControlServer extends EventEmitter {
    constructor(musicSearcher, playlistManager, audioPlayer) {
        super();
        this.musicSearcher = musicSearcher;
        this.playlistManager = playlistManager;
        this.audioPlayer = audioPlayer;

        // 客户端连接管理
        this.clients = new Set();
        this.currentSong = null;

        // 初始化服务器
        this.initServer();
    }

    initServer() {
        // 创建Express应用
        this.app = express();
        this.app.use(express.json());

        // 启用CORS（允许跨域访问）
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            if (req.method === 'OPTIONS') return res.sendStatus(200);
            next();
        });

        // 创建HTTP服务器
        this.server = http.createServer(this.app);

        // 创建WebSocket服务器
        this.wss = new WebSocket.Server({
            server: this.server,
            clientTracking: true
        });

        this.setupRoutes();
        this.setupWebSocket();
    }

    setupRoutes() {
        // 1. 远程播放接口（核心功能）
        this.app.post('/api/remote/play', async (req, res) => {
            try {
                const { bvid, title, artist, poster, playNow = true } = req.body;

                if (!bvid) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少必要参数: bvid'
                    });
                }

                console.log(`收到远程播放请求: ${title || bvid}`);

                // 处理歌曲播放
                const result = await this.handleRemotePlay(bvid, title, artist, poster, playNow);

                // 广播播放事件
                this.broadcast({
                    type: 'remotePlayStarted',
                    data: {
                        song: result.songInfo,
                        fromRemote: true,
                        timestamp: new Date().toISOString()
                    }
                });

                res.json({
                    success: true,
                    data: result
                });

            } catch (error) {
                console.error('远程播放失败:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // 2. 添加到播放列表（不立即播放）
        this.app.post('/api/remote/add-to-playlist', async (req, res) => {
            try {
                const { bvid, title, artist, poster } = req.body;

                if (!bvid) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少必要参数: bvid'
                    });
                }

                const songInfo = await this.addSongToPlaylist(bvid, title, artist, poster);

                // 广播播放列表更新
                this.broadcast({
                    type: 'playlistUpdated',
                    data: {
                        action: 'add',
                        song: songInfo,
                        playlistLength: this.playlistManager.playlist.length
                    }
                });

                res.json({
                    success: true,
                    data: {
                        song: songInfo,
                        addedAt: new Date().toISOString()
                    }
                });

            } catch (error) {
                console.error('添加到播放列表失败:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // 3. 获取当前播放状态
        this.app.get('/api/remote/status', (req, res) => {
            try {
                const status = this.getCurrentStatus();
                res.json({
                    success: true,
                    data: status
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // 4. 播放控制接口
        this.app.post('/api/remote/control', (req, res) => {
            try {
                const { action, value } = req.body;

                if (!action) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少action参数'
                    });
                }

                this.handleControlAction(action, value);

                // 广播控制事件
                this.broadcast({
                    type: 'remoteControl',
                    data: { action, value }
                });

                res.json({
                    success: true,
                    message: `执行动作: ${action}`
                });

            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // 5. 搜索歌曲（供WinUI3使用）
        this.app.get('/api/remote/search', async (req, res) => {
            try {
                const { keyword, page = 1 } = req.query;

                if (!keyword) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少搜索关键词'
                    });
                }

                const searchResults = await this.musicSearcher.searchBilibiliVideo(keyword, parseInt(page));

                // 转换为简单格式
                const songs = searchResults.map(item => ({
                    bvid: item.bvid,
                    title: item.title.replace(/<em class="keyword">|<\/em>/g, ""),
                    artist: item.author || '未知艺术家',
                    poster: item.pic.startsWith('http') ? item.pic : `https:${item.pic}`,
                    duration: item.duration,
                    playCount: item.play,
                    description: item.description
                }));

                res.json({
                    success: true,
                    data: {
                        songs,
                        keyword,
                        page: parseInt(page),
                        total: songs.length
                    }
                });

            } catch (error) {
                console.error('远程搜索失败:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // 6. 获取热门歌曲
        this.app.get('/api/remote/hot-songs', async (req, res) => {
            try {
                const { limit = 20 } = req.query;

                // 使用热门关键词搜索
                const searchResults = await this.musicSearcher.searchBilibiliVideo(
                    '热门音乐',
                    1,
                    'click'
                );

                const songs = searchResults.slice(0, parseInt(limit)).map(item => ({
                    bvid: item.bvid,
                    title: item.title.replace(/<em class="keyword">|<\/em>/g, ""),
                    artist: item.author || '未知艺术家',
                    poster: item.pic.startsWith('http') ? item.pic : `https:${item.pic}`,
                    duration: item.duration,
                    playCount: item.play
                }));

                res.json({
                    success: true,
                    data: {
                        songs,
                        count: songs.length
                    }
                });

            } catch (error) {
                console.error('获取热门歌曲失败:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // 7. 服务器信息
        this.app.get('/api/remote/info', (req, res) => {
            res.json({
                success: true,
                data: {
                    server: 'NB Music Remote Control',
                    version: '1.0.0',
                    endpoints: {
                        play: 'POST /api/remote/play',
                        add: 'POST /api/remote/add-to-playlist',
                        control: 'POST /api/remote/control',
                        search: 'GET /api/remote/search',
                        hotSongs: 'GET /api/remote/hot-songs',
                        status: 'GET /api/remote/status'
                    },
                    connectedClients: this.clients.size,
                    currentSong: this.currentSong
                }
            });
        });
    }

    setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            console.log('新的远程客户端连接');
            this.clients.add(ws);

            // 发送欢迎消息
            ws.send(JSON.stringify({
                type: 'welcome',
                data: {
                    message: '已连接到NB Music远程控制',
                    serverTime: new Date().toISOString(),
                    endpoints: [
                        { method: 'POST', path: '/api/remote/play', desc: '远程播放歌曲' },
                        { method: 'GET', path: '/api/remote/search', desc: '搜索歌曲' },
                        { method: 'GET', path: '/api/remote/hot-songs', desc: '获取热门歌曲' }
                    ]
                }
            }));

            // 发送当前状态
            const currentStatus = this.getCurrentStatus();
            ws.send(JSON.stringify({
                type: 'currentStatus',
                data: currentStatus
            }));

            // 处理消息
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleWebSocketMessage(ws, data);
                } catch (error) {
                    console.error('WebSocket消息解析失败:', error);
                }
            });

            // 断开连接
            ws.on('close', () => {
                console.log('远程客户端断开连接');
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket错误:', error);
                this.clients.delete(ws);
            });
        });
    }

    async handleRemotePlay(bvid, title, artist, poster, playNow) {
        // 检查歌曲是否已在播放列表中
        const existingIndex = this.playlistManager.playlist.findIndex(
            song => song.bvid === bvid
        );

        let songInfo;
        let songIndex;

        if (existingIndex !== -1) {
            // 歌曲已存在
            songInfo = this.playlistManager.playlist[existingIndex];
            songIndex = existingIndex;
            console.log(`歌曲已存在于播放列表中，位置: ${songIndex}`);
        } else {
            // 新歌曲，获取音频链接
            console.log(`获取音频链接: ${bvid}`);
            const urls = await this.musicSearcher.getAudioLink(bvid, true);
            let url = urls[0];

            // 尝试备用链接
            try {
                const axios = require('axios');
                const res = await axios.get(url);
                if (res.status === 403) {
                    url = urls[1];
                }
            } catch {
                url = urls[1];
            }

            // 构建歌曲信息
            songInfo = {
                title: title || `B站视频 ${bvid}`,
                artist: artist || '未知艺术家',
                poster: poster || '',
                bvid: bvid,
                audio: url,
                cid: urls[2],
                lyric: '等待获取歌词',
                fromRemote: true,
                addedAt: new Date().toISOString()
            };

            // 添加到播放列表
            this.playlistManager.addSong(songInfo);
            songIndex = this.playlistManager.playlist.length - 1;
            console.log(`新歌曲添加到播放列表，位置: ${songIndex}`);
        }

        // 更新当前歌曲
        this.currentSong = songInfo;

        if (playNow) {
            // 切换到播放器界面
            this.switchToPlayerPage();

            // 设置并播放歌曲
            this.playlistManager.setPlayingNow(songIndex);
            this.audioPlayer.play();

            console.log(`开始播放: ${songInfo.title}`);
        }

        return {
            songInfo,
            songIndex,
            playlistLength: this.playlistManager.playlist.length,
            played: playNow
        };
    }

    async addSongToPlaylist(bvid, title, artist, poster) {
        // 检查是否已存在
        const existingIndex = this.playlistManager.playlist.findIndex(
            song => song.bvid === bvid
        );

        if (existingIndex !== -1) {
            return this.playlistManager.playlist[existingIndex];
        }

        // 获取音频链接
        const urls = await this.musicSearcher.getAudioLink(bvid, true);
        let url = urls[0];

        try {
            const axios = require('axios');
            const res = await axios.get(url);
            if (res.status === 403) {
                url = urls[1];
            }
        } catch {
            url = urls[1];
        }

        // 构建歌曲信息
        const songInfo = {
            title: title || `B站视频 ${bvid}`,
            artist: artist || '未知艺术家',
            poster: poster || '',
            bvid: bvid,
            audio: url,
            cid: urls[2],
            lyric: '等待获取歌词',
            fromRemote: true,
            addedAt: new Date().toISOString()
        };

        // 添加到播放列表
        this.playlistManager.addSong(songInfo);

        return songInfo;
    }

    switchToPlayerPage() {
        try {
            // 查找播放器按钮并点击
            const playerButtons = document.querySelectorAll('#function-list .player, .player-btn, [data-page="player"]');

            if (playerButtons.length > 0) {
                playerButtons[0].click();
                console.log('已切换到播放器界面');
                return true;
            } else {
                console.warn('未找到播放器切换按钮');
                return false;
            }
        } catch (error) {
            console.error('切换播放器界面失败:', error);
            return false;
        }
    }

    handleControlAction(action, value) {
        switch (action) {
            case 'play':
                this.audioPlayer.play();
                break;
            case 'pause':
                this.audioPlayer.play(); // 注意：AudioPlayer的play方法切换播放/暂停
                break;
            case 'next':
                this.audioPlayer.next();
                break;
            case 'prev':
                this.audioPlayer.prev();
                break;
            case 'volume':
                if (value !== undefined && this.audioPlayer.settingManager) {
                    const volume = Math.max(0, Math.min(100, parseInt(value)));
                    this.audioPlayer.settingManager.setSetting('volume', volume);
                    this.audioPlayer.audio.volume = volume / 100;
                }
                break;
            case 'seek':
                if (value !== undefined && this.audioPlayer.audio) {
                    const duration = this.audioPlayer.audio.duration;
                    if (duration && !isNaN(duration)) {
                        const targetTime = (parseInt(value) / 100) * duration;
                        this.audioPlayer.audio.currentTime = targetTime;
                    }
                }
                break;
            default:
                console.warn(`未知的控制动作: ${action}`);
        }
    }

    handleWebSocketMessage(ws, data) {
        const { type, payload } = data;

        switch (type) {
            case 'play':
                if (payload && payload.bvid) {
                    this.handleRemotePlay(
                        payload.bvid,
                        payload.title,
                        payload.artist,
                        payload.poster,
                        true
                    );
                }
                break;
            case 'control':
                if (payload && payload.action) {
                    this.handleControlAction(payload.action, payload.value);
                }
                break;
            case 'status':
                const status = this.getCurrentStatus();
                ws.send(JSON.stringify({
                    type: 'statusResponse',
                    data: status
                }));
                break;
            default:
                console.warn(`未知的WebSocket消息类型: ${type}`);
        }
    }

    getCurrentStatus() {
        const currentSong = this.playlistManager.playlist[this.playlistManager.playingNow];

        return {
            isPlaying: !this.audioPlayer.audio.paused,
            currentTime: this.audioPlayer.audio.currentTime || 0,
            duration: this.audioPlayer.audio.duration || 0,
            volume: this.audioPlayer.settingManager
                ? this.audioPlayer.settingManager.getSetting('volume')
                : 100,
            currentSong: currentSong ? {
                title: currentSong.title,
                artist: currentSong.artist,
                bvid: currentSong.bvid,
                poster: currentSong.poster
            } : null,
            playlistLength: this.playlistManager.playlist.length,
            currentIndex: this.playlistManager.playingNow,
            playMode: this.playlistManager.playMode,
            serverTime: new Date().toISOString()
        };
    }

    broadcast(data) {
        const message = JSON.stringify(data);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    start(port = 3001) {
        return new Promise((resolve, reject) => {
            this.server.listen(port, '0.0.0.0', () => {
                console.log(`📡 NB Music 远程控制服务器已启动`);
                console.log(`🌐 HTTP API: http://localhost:${port}`);
                console.log(`🔌 WebSocket: ws://localhost:${port}`);
                console.log(`📊 状态接口: http://localhost:${port}/api/remote/info`);
                console.log(`🎵 远程播放: POST http://localhost:${port}/api/remote/play`);
                console.log(`🔍 远程搜索: GET http://localhost:${port}/api/remote/search?keyword=歌曲名`);

                resolve({
                    port,
                    httpUrl: `http://localhost:${port}`,
                    wsUrl: `ws://localhost:${port}`
                });
            });

            this.server.on('error', reject);
        });
    }

    stop() {
        return new Promise((resolve) => {
            this.wss.close(() => {
                this.server.close(() => {
                    console.log('远程控制服务器已停止');
                    resolve();
                });
            });

            this.clients.forEach(client => client.close());
            this.clients.clear();
        });
    }
}

module.exports = RemoteControlServer;