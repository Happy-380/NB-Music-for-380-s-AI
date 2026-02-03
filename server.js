/* 
    提供为其他外部应用API访问，读取和控制播放支持（一架从南航跑出来的380）
*/

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { EventEmitter } = require('events');

class NBMusicServer extends EventEmitter {
    constructor(musicSearcher, audioPlayer, playlistManager) {
        super();
        this.musicSearcher = musicSearcher;
        this.audioPlayer = audioPlayer;
        this.playlistManager = playlistManager;

        // 热门歌曲缓存
        this.hotSongsCache = [];
        this.cacheExpiry = 5 * 60 * 1000; // 5分钟缓存
        this.lastCacheUpdate = 0;

        // 客户端连接管理
        this.clients = new Set();

        this.initServer();
    }

    initServer() {
        this.app = express();
        this.app.use(cors());
        this.app.use(express.json());

        // 创建HTTP服务器
        this.server = http.createServer(this.app);

        // 创建WebSocket服务器
        this.wss = new WebSocket.Server({
            server: this.server,
            clientTracking: true
        });

        this.setupRoutes();
        this.setupWebSocket();

        // 启动缓存更新任务
        this.startCacheUpdate();
    }

    setupRoutes() {
        // 1. 热门歌曲API
        this.app.get('/api/hot-songs', async (req, res) => {
            try {
                const { limit = 20, page = 1, keyword } = req.query;
                const songs = await this.getHotSongs(parseInt(limit), parseInt(page), keyword);

                res.json({
                    success: true,
                    data: {
                        songs,
                        total: songs.length,
                        page: parseInt(page),
                        limit: parseInt(limit)
                    }
                });
            } catch (error) {
                console.error('获取热门歌曲失败:', error);
                res.status(500).json({
                    success: false,
                    error: {
                        code: 500,
                        message: '获取热门歌曲失败'
                    }
                });
            }
        });

        // 2. 搜索歌曲API
        this.app.get('/api/search', async (req, res) => {
            try {
                const { keyword, page = 1 } = req.query;

                if (!keyword) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 400,
                            message: '搜索关键词不能为空'
                        }
                    });
                }

                // 调用MusicSearcher的搜索功能
                const searchResults = await this.musicSearcher.searchBilibiliVideo(keyword, parseInt(page));

                // 转换为标准格式
                const songs = searchResults.map(item => ({
                    bvid: item.bvid,
                    title: item.title.replace(/<em class="keyword">|<\/em>/g, ""),
                    artist: item.author || '未知艺术家',
                    poster: 'https:' + item.pic,
                    duration: item.duration,
                    playCount: item.play,
                    description: item.description
                }));

                res.json({
                    success: true,
                    data: {
                        songs,
                        keyword,
                        page: parseInt(page)
                    }
                });
            } catch (error) {
                console.error('搜索失败:', error);
                res.status(500).json({
                    success: false,
                    error: {
                        code: 500,
                        message: '搜索失败: ' + error.message
                    }
                });
            }
        });

        // 3. 播放控制API
        this.app.post('/api/player/control', (req, res) => {
            try {
                const { action, data } = req.body;

                if (!action) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 400,
                            message: '缺少action参数'
                        }
                    });
                }

                // 执行播放控制
                this.handlePlayerControl(action, data);

                res.json({
                    success: true,
                    message: `执行动作: ${action}`
                });

                // 广播播放状态更新
                this.broadcastPlaybackState();
            } catch (error) {
                console.error('播放控制失败:', error);
                res.status(500).json({
                    success: false,
                    error: {
                        code: 500,
                        message: '播放控制失败: ' + error.message
                    }
                });
            }
        });

        // 4. 当前播放状态API
        this.app.get('/api/player/status', (req, res) => {
            try {
                const status = this.getCurrentPlaybackStatus();
                res.json({
                    success: true,
                    data: status
                });
            } catch (error) {
                console.error('获取播放状态失败:', error);
                res.status(500).json({
                    success: false,
                    error: {
                        code: 500,
                        message: '获取播放状态失败'
                    }
                });
            }
        });

        // 5. 添加歌曲到播放列表
        this.app.post('/api/playlist/add', async (req, res) => {
            try {
                const { bvid, title, artist, poster } = req.body;

                if (!bvid) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 400,
                            message: '缺少bvid参数'
                        }
                    });
                }

                // 获取音频链接
                const urls = await this.musicSearcher.getAudioLink(bvid, true);
                let url = urls[0];

                try {
                    const axios = require('axios');
                    const resTest = await axios.get(url);
                    if (resTest.status === 403) {
                        url = urls[1];
                    }
                } catch {
                    url = urls[1];
                }

                // 创建歌曲对象
                const songInfo = {
                    title: title || `B站视频 ${bvid}`,
                    artist: artist || '未知艺术家',
                    poster: poster || '',
                    bvid: bvid,
                    audio: url,
                    cid: urls[2],
                    lyric: '等待获取歌词'
                };

                // 添加到播放列表
                this.playlistManager.addSong(songInfo);

                res.json({
                    success: true,
                    data: {
                        song: songInfo,
                        playlistLength: this.playlistManager.playlist.length
                    }
                });

                // 广播播放列表更新
                this.broadcastPlaylistUpdate();
            } catch (error) {
                console.error('添加歌曲失败:', error);
                res.status(500).json({
                    success: false,
                    error: {
                        code: 500,
                        message: '添加歌曲失败: ' + error.message
                    }
                });
            }
        });

        // 6. 服务器状态API
        this.app.get('/api/server/status', (req, res) => {
            res.json({
                success: true,
                data: {
                    status: 'running',
                    version: '1.0.0',
                    connectedClients: this.clients.size,
                    cacheSize: this.hotSongsCache.length,
                    lastCacheUpdate: new Date(this.lastCacheUpdate).toISOString()
                }
            });
        });

        // 7. 静态文件服务（用于Web客户端）
        this.app.use('/web', express.static('public'));
    }

    setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            console.log('新的WebSocket连接建立');
            this.clients.add(ws);

            // 发送欢迎消息和当前状态
            ws.send(JSON.stringify({
                type: 'welcome',
                data: {
                    message: 'Connected to NB Music Server',
                    serverTime: new Date().toISOString(),
                    playbackStatus: this.getCurrentPlaybackStatus()
                }
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

            // 处理断开连接
            ws.on('close', () => {
                console.log('WebSocket连接断开');
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket错误:', error);
                this.clients.delete(ws);
            });
        });
    }

    async getHotSongs(limit = 20, page = 1, keyword = null) {
        const now = Date.now();

        // 检查缓存是否过期
        if (now - this.lastCacheUpdate > this.cacheExpiry || keyword) {
            await this.updateHotSongsCache(keyword);
        }

        // 分页逻辑
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;

        return this.hotSongsCache.slice(startIndex, endIndex);
    }

    async updateHotSongsCache(keyword = null) {
        try {
            // 这里可以根据实际情况调整搜索关键词
            // 例如：热门歌曲、流行音乐、排行榜等
            const searchKeyword = keyword || '流行音乐 热门歌曲';
            const searchResults = await this.musicSearcher.searchBilibiliVideo(searchKeyword, 1, 'click');

            // 转换为标准格式并添加额外信息
            this.hotSongsCache = searchResults.map(item => ({
                bvid: item.bvid,
                title: item.title.replace(/<em class="keyword">|<\/em>/g, ""),
                artist: item.author || '未知艺术家',
                poster: 'https:' + item.pic,
                duration: item.duration,
                playCount: item.play,
                description: item.description,
                pubDate: item.pubdate ? new Date(item.pubdate * 1000).toISOString() : null,
                isHot: item.play > 100000 // 播放量超过10万视为热门
            }));

            // 按播放量排序
            this.hotSongsCache.sort((a, b) => b.playCount - a.playCount);

            this.lastCacheUpdate = Date.now();
            console.log(`热门歌曲缓存已更新，共${this.hotSongsCache.length}首歌曲`);

            // 广播缓存更新
            this.broadcast({
                type: 'hotSongsUpdated',
                data: {
                    count: this.hotSongsCache.length,
                    updatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('更新热门歌曲缓存失败:', error);
            // 如果更新失败，保持旧缓存
        }
    }

    handlePlayerControl(action, data = {}) {
        switch (action) {
            case 'play':
                this.audioPlayer.play();
                break;
            case 'pause':
                // AudioPlayer的pause方法内部调用了play()进行切换
                this.audioPlayer.play();
                break;
            case 'next':
                this.audioPlayer.next();
                break;
            case 'prev':
                this.audioPlayer.prev();
                break;
            case 'playSong':
                if (data.index !== undefined) {
                    this.playlistManager.setPlayingNow(data.index);
                } else if (data.bvid) {
                    // 根据bvid查找并播放歌曲
                    const index = this.playlistManager.playlist.findIndex(
                        song => song.bvid === data.bvid
                    );
                    if (index !== -1) {
                        this.playlistManager.setPlayingNow(index);
                    }
                }
                break;
            case 'setVolume':
                if (data.volume !== undefined && this.audioPlayer.settingManager) {
                    this.audioPlayer.settingManager.setSetting('volume', data.volume);
                    // 立即应用音量变化
                    const currentVolume = Math.max(0, data.volume / 100);
                    this.audioPlayer.audio.volume = currentVolume;
                }
                break;
            case 'setProgress':
                if (data.progress !== undefined && this.audioPlayer.audio) {
                    const targetTime = (data.progress / 100) * this.audioPlayer.audio.duration;
                    this.audioPlayer.audio.currentTime = targetTime;
                }
                break;
            default:
                console.warn(`未知的播放控制动作: ${action}`);
        }
    }

    getCurrentPlaybackStatus() {
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
            playMode: this.playlistManager.playMode
        };
    }

    handleWebSocketMessage(ws, data) {
        const { type, payload } = data;

        switch (type) {
            case 'control':
                this.handlePlayerControl(payload.action, payload.data);
                break;
            case 'requestStatus':
                ws.send(JSON.stringify({
                    type: 'playbackStatus',
                    data: this.getCurrentPlaybackStatus()
                }));
                break;
            case 'subscribe':
                // 客户端订阅特定事件
                this.handleSubscription(ws, payload.events);
                break;
            case 'search':
                // 处理搜索请求
                this.handleSearchRequest(ws, payload);
                break;
            default:
                console.warn(`未知的WebSocket消息类型: ${type}`);
        }
    }

    handleSubscription(ws, events) {
        // 这里可以实现具体的事件订阅逻辑
        // 暂时只记录订阅信息
        console.log(`客户端订阅了事件: ${events.join(', ')}`);

        ws.send(JSON.stringify({
            type: 'subscriptionConfirmed',
            data: {
                events: events,
                subscribedAt: new Date().toISOString()
            }
        }));
    }

    async handleSearchRequest(ws, payload) {
        const { keyword, page = 1 } = payload;

        try {
            const searchResults = await this.musicSearcher.searchBilibiliVideo(keyword, page);

            ws.send(JSON.stringify({
                type: 'searchResults',
                data: {
                    keyword,
                    page,
                    results: searchResults.map(item => ({
                        bvid: item.bvid,
                        title: item.title.replace(/<em class="keyword">|<\/em>/g, ""),
                        artist: item.author || '未知艺术家',
                        poster: 'https:' + item.pic,
                        duration: item.duration
                    }))
                }
            }));
        } catch (error) {
            ws.send(JSON.stringify({
                type: 'error',
                data: {
                    message: '搜索失败: ' + error.message
                }
            }));
        }
    }

    broadcast(data) {
        const message = JSON.stringify(data);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    broadcastPlaybackState() {
        const status = this.getCurrentPlaybackStatus();
        this.broadcast({
            type: 'playbackStateChanged',
            data: status
        });
    }

    broadcastPlaylistUpdate() {
        const playlist = this.playlistManager.playlist.map(song => ({
            title: song.title,
            artist: song.artist,
            bvid: song.bvid,
            poster: song.poster
        }));

        this.broadcast({
            type: 'playlistUpdated',
            data: {
                playlist,
                currentIndex: this.playlistManager.playingNow
            }
        });
    }

    startCacheUpdate() {
        // 初始缓存
        this.updateHotSongsCache();

        // 定时更新缓存
        setInterval(() => {
            this.updateHotSongsCache();
        }, this.cacheExpiry);

        // 监听音频播放事件，实时更新状态
        if (this.audioPlayer.audio) {
            this.audioPlayer.audio.addEventListener('timeupdate', () => {
                this.broadcastPlaybackState();
            });

            this.audioPlayer.audio.addEventListener('play', () => {
                this.broadcastPlaybackState();
            });

            this.audioPlayer.audio.addEventListener('pause', () => {
                this.broadcastPlaybackState();
            });

            this.audioPlayer.audio.addEventListener('ended', () => {
                this.broadcastPlaybackState();
            });
        }

        // 监听播放列表变化
        if (this.playlistManager) {
            // 这里需要根据PlaylistManager的实际实现来添加事件监听
            // 暂时使用轮询的方式
            let lastPlaylistLength = 0;
            setInterval(() => {
                if (this.playlistManager.playlist.length !== lastPlaylistLength) {
                    lastPlaylistLength = this.playlistManager.playlist.length;
                    this.broadcastPlaylistUpdate();
                }
            }, 1000);
        }
    }

    start(port = 3000) {
        this.server.listen(port, () => {
            console.log(`NB Music 服务器已启动`);
            console.log(`REST API: http://localhost:${port}`);
            console.log(`WebSocket: ws://localhost:${port}`);
            console.log(`状态接口: http://localhost:${port}/api/server/status`);

            this.emit('serverStarted', {
                port,
                startedAt: new Date().toISOString()
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            this.wss.close(() => {
                this.server.close(() => {
                    console.log('NB Music 服务器已停止');
                    this.emit('serverStopped');
                    resolve();
                });
            });

            // 关闭所有客户端连接
            this.clients.forEach(client => {
                client.close();
            });
            this.clients.clear();
        });
    }
}

module.exports = NBMusicServer;